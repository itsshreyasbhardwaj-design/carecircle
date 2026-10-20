import { beforeEach, describe, expect, it } from 'vitest';
import { makeProfile, makeUser, resetDb } from './helpers.ts';
import {
  AuthzError, assertCan, can, canReadDocument, expand, grantedScopes,
  isCircleCoordinator, profileScopeFilter, visibleProfileIds,
} from '../src/lib/authz.ts';
import { grantAccess, revokeGrant, sweepExpiredGrants } from '../src/lib/consent.ts';
import { db, one } from '../src/db/index.ts';
import { newId } from '../src/lib/ids.ts';
import { nowIso } from '../src/lib/time.ts';

function makeDocument(profileId: string, uploaderId: string, sensitivity = 'standard'): string {
  const id = newId('doc');
  db().prepare(
    `INSERT INTO medical_documents
     (id, care_profile_id, uploaded_by_user_id, title, category, sensitivity,
      created_at, updated_at)
     VALUES (?,?,?,?,'lab_report',?,?,?)`,
  ).run(id, profileId, uploaderId, 'Fictional report', sensitivity, nowIso(), nowIso());
  return id;
}

describe('authorisation invariant', () => {
  beforeEach(resetDb);

  it('an owner can do everything on their own profile', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    expect(can(owner.id, 'records:view', profile)).toBe(true);
    expect(can(owner.id, 'medications:manage', profile)).toBe(true);
  });

  it('a stranger can do nothing, and the denial is audited', () => {
    const owner = makeUser();
    const stranger = makeUser();
    const profile = makeProfile(owner.id);
    expect(can(stranger.id, 'records:view', profile)).toBe(false);
    expect(() => assertCan(stranger.id, 'records:view', profile)).toThrow(AuthzError);
    const denial = one<{ outcome: string }>(
      'SELECT outcome FROM audit_events WHERE actor_user_id = ? ORDER BY occurred_at DESC',
      stranger.id,
    );
    expect(denial?.outcome).toBe('denied');
  });

  it('being in the same circle grants nothing on its own', () => {
    const owner = makeUser();
    const member = makeUser();
    const profile = makeProfile(owner.id);
    const circle = newId('cir');
    db().prepare('INSERT INTO care_circles (id,name,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(circle, 'Family', owner.id, nowIso(), nowIso());
    for (const [u, role] of [[owner.id, 'coordinator'], [member.id, 'member']] as const) {
      db().prepare('INSERT INTO circle_memberships (id,circle_id,user_id,role,joined_at) VALUES (?,?,?,?,?)')
        .run(newId('mem'), circle, u, role, nowIso());
    }
    db().prepare('INSERT INTO circle_profiles (id,circle_id,care_profile_id,added_by_user_id,added_at) VALUES (?,?,?,?,?)')
      .run(newId('cpf'), circle, profile, owner.id, nowIso());

    // Even the coordinator — who runs the circle — gets no record access.
    expect(isCircleCoordinator(owner.id, circle)).toBe(true);
    expect(can(member.id, 'records:view', profile)).toBe(false);
    expect(can(member.id, 'appointments:view', profile)).toBe(false);
    expect(visibleProfileIds(member.id, 'records:view')).toEqual([]);
  });

  it('a granted scope works and revocation takes effect immediately', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const grant = grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'appointments:view',
      purpose: 'Takes me to appointments', grantedByUserId: owner.id,
    });
    expect(can(caregiver.id, 'appointments:view', profile)).toBe(true);
    expect(can(caregiver.id, 'records:view', profile)).toBe(false);

    revokeGrant(grant, owner.id);
    expect(can(caregiver.id, 'appointments:view', profile)).toBe(false);
    expect(visibleProfileIds(caregiver.id, 'appointments:view')).toEqual([]);
  });

  it('manage implies view, but upload does not imply read', () => {
    expect(expand(['appointments:manage']).has('appointments:view')).toBe(true);
    expect(expand(['records:upload']).has('records:view')).toBe(false);

    const owner = makeUser();
    const helper = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: helper.id, scope: 'records:upload',
      purpose: 'Scans prescriptions for me', grantedByUserId: owner.id,
    });
    expect(can(helper.id, 'records:upload', profile)).toBe(true);
    expect(can(helper.id, 'records:view', profile)).toBe(false);
    const doc = makeDocument(profile, owner.id);
    expect(canReadDocument(helper.id, doc)).toBe(false);
  });

  it('an expired grant stops working without any sweep running', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'tasks:view',
      purpose: 'Covering this week', grantedByUserId: owner.id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(can(caregiver.id, 'tasks:view', profile)).toBe(false);
    expect(grantedScopes(caregiver.id, profile).size).toBe(0);
    // The sweep is bookkeeping only; enforcement already happened above.
    expect(sweepExpiredGrants()).toBe(1);
    expect(sweepExpiredGrants()).toBe(0); // idempotent
  });

  it('restricted documents need a grant naming that document', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const standard = makeDocument(profile, owner.id, 'standard');
    const restricted = makeDocument(profile, owner.id, 'restricted');
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'Helping with my cardiology file', grantedByUserId: owner.id,
    });
    expect(canReadDocument(caregiver.id, standard)).toBe(true);
    expect(canReadDocument(caregiver.id, restricted)).toBe(false);

    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      documentId: restricted, purpose: 'Just this one report', grantedByUserId: owner.id,
    });
    expect(canReadDocument(caregiver.id, restricted)).toBe(true);
  });

  it('only the profile owner can widen access to it', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const outsider = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'tasks:manage',
      purpose: 'Coordinates tasks', grantedByUserId: owner.id,
    });
    // A caregiver with manage rights still cannot pass access to someone else.
    expect(() =>
      grantAccess({
        careProfileId: profile, granteeUserId: outsider.id, scope: 'tasks:view',
        purpose: 'escalation attempt', grantedByUserId: caregiver.id,
      }),
    ).toThrow(AuthzError);
    expect(can(outsider.id, 'tasks:view', profile)).toBe(false);
  });

  it('list filters select nothing rather than everything when access is empty', () => {
    const stranger = makeUser();
    const f = profileScopeFilter(stranger.id, 'records:view');
    expect(f.sql).toBe('1 = 0');
    expect(f.params).toEqual([]);
  });

  it('a grantee may hand back their own access', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const grant = grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'tasks:view',
      purpose: 'Temporary cover', grantedByUserId: owner.id,
    });
    revokeGrant(grant, caregiver.id);
    expect(can(caregiver.id, 'tasks:view', profile)).toBe(false);
  });
});
