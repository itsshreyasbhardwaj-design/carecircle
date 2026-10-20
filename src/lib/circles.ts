import { all, one, run, tx } from '../db/index.ts';
import { newId } from './ids.ts';
import { addDays, nowIso } from './time.ts';
import { audit } from './audit.ts';
import { newToken, tokenHash } from './crypto.ts';
import {
  AuthzError, SCOPE_LABELS, type Scope, assertCircleCoordinator, assertCircleMember,
  isCircleMember, isScope, ownsProfile,
} from './authz.ts';
import { grantAccess } from './consent.ts';

export type Circle = { id: string; name: string; created_by_user_id: string; is_demo: number;
                       created_at: string; updated_at: string };
export type Member = { user_id: string; full_name: string; email: string;
                       role: 'coordinator' | 'member'; joined_at: string };

export function createCircle(userId: string, name: string, isDemo = false): string {
  const id = newId('cir');
  const now = nowIso();
  tx((d) => {
    d.prepare('INSERT INTO care_circles (id,name,created_by_user_id,is_demo,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, name.trim(), userId, isDemo ? 1 : 0, now, now);
    d.prepare('INSERT INTO circle_memberships (id,circle_id,user_id,role,joined_at) VALUES (?,?,?,?,?)')
      .run(newId('mem'), id, userId, 'coordinator', now);
  });
  audit({ actorUserId: userId, action: 'circle:create', resourceType: 'care_circle',
          resourceId: id, outcome: 'allowed' });
  return id;
}

export function circlesFor(userId: string): (Circle & { role: string; member_count: number })[] {
  return all(
    `SELECT c.*, m.role,
            (SELECT count(*) FROM circle_memberships x
             WHERE x.circle_id = c.id AND x.removed_at IS NULL) AS member_count
     FROM care_circles c
     JOIN circle_memberships m ON m.circle_id = c.id AND m.user_id = ? AND m.removed_at IS NULL
     ORDER BY c.name`,
    userId,
  );
}

export function getCircle(id: string): Circle | undefined {
  return one<Circle>('SELECT * FROM care_circles WHERE id = ?', id);
}

export function members(circleId: string): Member[] {
  return all<Member>(
    `SELECT m.user_id, u.full_name, u.email, m.role, m.joined_at
     FROM circle_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.circle_id = ? AND m.removed_at IS NULL
     ORDER BY m.role, u.full_name`,
    circleId,
  );
}

/** Lists a profile in a circle. Exposes the display name only — never its data. */
export function listProfileInCircle(actorUserId: string, circleId: string, profileId: string): void {
  assertCircleMember(actorUserId, circleId);
  if (!ownsProfile(actorUserId, profileId)) {
    throw new AuthzError('You can only add a profile you control to a circle.');
  }
  const existing = one('SELECT 1 FROM circle_profiles WHERE circle_id = ? AND care_profile_id = ?',
    circleId, profileId);
  if (existing) return;
  run('INSERT INTO circle_profiles (id,circle_id,care_profile_id,added_by_user_id,added_at) VALUES (?,?,?,?,?)',
    newId('cpf'), circleId, profileId, actorUserId, nowIso());
  audit({ actorUserId, action: 'circle:list_profile', resourceType: 'care_circle',
          resourceId: circleId, careProfileId: profileId, outcome: 'allowed' });
}

export function unlistProfileFromCircle(actorUserId: string, circleId: string, profileId: string): void {
  if (!ownsProfile(actorUserId, profileId)) throw new AuthzError();
  run('DELETE FROM circle_profiles WHERE circle_id = ? AND care_profile_id = ?', circleId, profileId);
  audit({ actorUserId, action: 'circle:unlist_profile', resourceType: 'care_circle',
          resourceId: circleId, careProfileId: profileId, outcome: 'allowed' });
}

export function circleProfiles(circleId: string) {
  return all<{ id: string; display_name: string; owner_user_id: string; owner_name: string;
               profile_kind: string }>(
    `SELECT p.id, p.display_name, p.owner_user_id, u.full_name AS owner_name, p.profile_kind
     FROM circle_profiles cp
     JOIN care_profiles p ON p.id = cp.care_profile_id AND p.deleted_at IS NULL
     JOIN users u ON u.id = p.owner_user_id
     WHERE cp.circle_id = ? ORDER BY p.display_name`,
    circleId,
  );
}

export function leaveCircle(userId: string, circleId: string): void {
  const coordinators = all<{ user_id: string }>(
    `SELECT user_id FROM circle_memberships
     WHERE circle_id = ? AND role = 'coordinator' AND removed_at IS NULL`, circleId);
  if (coordinators.length === 1 && coordinators[0]?.user_id === userId) {
    throw new AuthzError('Promote another coordinator before you leave this circle.');
  }
  tx((d) => {
    d.prepare('UPDATE circle_memberships SET removed_at = ? WHERE circle_id = ? AND user_id = ? AND removed_at IS NULL')
      .run(nowIso(), circleId, userId);
    // Leaving a circle does not by itself end consent, so unlist the profiles the
    // leaver owns and revoke grants they held from this circle's members.
    d.prepare('DELETE FROM circle_profiles WHERE circle_id = ? AND care_profile_id IN (SELECT id FROM care_profiles WHERE owner_user_id = ?)')
      .run(circleId, userId);
  });
  audit({ actorUserId: userId, action: 'circle:leave', resourceType: 'care_circle',
          resourceId: circleId, outcome: 'allowed' });
}

/**
 * Removing someone from a circle also revokes every grant that circle's listed
 * profiles gave them. Roster removal alone would leave stale access behind.
 */
export function removeMember(actorUserId: string, circleId: string, targetUserId: string): number {
  assertCircleCoordinator(actorUserId, circleId);
  if (targetUserId === actorUserId) throw new AuthzError('Use "leave circle" to remove yourself.');
  let revoked = 0;
  tx((d) => {
    d.prepare('UPDATE circle_memberships SET removed_at = ? WHERE circle_id = ? AND user_id = ? AND removed_at IS NULL')
      .run(nowIso(), circleId, targetUserId);
    // Read the grant details before revoking so the ledger row is complete.
    const grants = d.prepare(
      `SELECT g.id, g.care_profile_id, g.grantee_user_id, g.scope, g.document_id, g.purpose
       FROM access_grants g
       JOIN circle_profiles cp ON cp.care_profile_id = g.care_profile_id
       WHERE cp.circle_id = ? AND g.grantee_user_id = ? AND g.revoked_at IS NULL`,
    ).all(circleId, targetUserId) as {
      id: string; care_profile_id: string; grantee_user_id: string; scope: string;
      document_id: string | null; purpose: string;
    }[];
    for (const g of grants) {
      d.prepare('UPDATE access_grants SET revoked_at = ?, revoked_by_user_id = ? WHERE id = ?')
        .run(nowIso(), actorUserId, g.id);
      d.prepare(
        `INSERT INTO consent_records
         (id, access_grant_id, care_profile_id, grantee_user_id, scope, document_id,
          action, purpose, actor_user_id, occurred_at)
         VALUES (?,?,?,?,?,?,'revoked',?,?,?)`,
      ).run(newId('con'), g.id, g.care_profile_id, g.grantee_user_id, g.scope,
            g.document_id, g.purpose, actorUserId, nowIso());
      revoked += 1;
    }
  });
  audit({ actorUserId, action: 'circle:remove_member', resourceType: 'care_circle',
          resourceId: circleId, outcome: 'allowed',
          detail: { target: targetUserId, grants_revoked: revoked } });
  return revoked;
}

export function setMemberRole(
  actorUserId: string, circleId: string, targetUserId: string, role: 'coordinator' | 'member',
): void {
  assertCircleCoordinator(actorUserId, circleId);
  run('UPDATE circle_memberships SET role = ? WHERE circle_id = ? AND user_id = ? AND removed_at IS NULL',
    role, circleId, targetUserId);
  audit({ actorUserId, action: 'circle:set_role', resourceType: 'care_circle', resourceId: circleId,
          outcome: 'allowed', detail: { target: targetUserId, role } });
}

// ---------------------------------------------------------------- invitations

export type OfferedGrant = { careProfileId: string; scope: Scope; expiresAt?: string | null };

export type Invitation = {
  id: string; circle_id: string; invited_email: string | null; role: 'coordinator' | 'member';
  offered_grants: string; message: string | null; created_at: string; expires_at: string;
  accepted_at: string | null; revoked_at: string | null; created_by_user_id: string;
};

export const INVITE_TTL_DAYS = 7;

/**
 * Creates an invitation. The raw token is returned once and never stored — only
 * its hash is, so a database read cannot reconstruct a working link.
 * There is no email provider configured: the caller copies the link by hand.
 */
export function createInvitation(input: {
  actorUserId: string; circleId: string; role: 'coordinator' | 'member';
  invitedEmail?: string | null; message?: string | null; offeredGrants?: OfferedGrant[];
}): { id: string; token: string; expiresAt: string } {
  assertCircleCoordinator(input.actorUserId, input.circleId);
  // You may only offer access to profiles you actually control.
  for (const g of input.offeredGrants ?? []) {
    if (!ownsProfile(input.actorUserId, g.careProfileId)) {
      throw new AuthzError('You can only offer access to a profile you control.');
    }
    if (!isScope(g.scope)) throw new Error(`Unknown permission: ${g.scope}`);
  }
  const token = newToken();
  const id = newId('inv');
  const expiresAt = addDays(nowIso(), INVITE_TTL_DAYS);
  run(
    `INSERT INTO invitations
     (id, circle_id, token_hash, invited_email, role, offered_grants, message,
      created_by_user_id, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, input.circleId, tokenHash(token),
    input.invitedEmail?.trim().toLowerCase() ?? null, input.role,
    JSON.stringify(input.offeredGrants ?? []), input.message ?? null,
    input.actorUserId, nowIso(), expiresAt,
  );
  audit({ actorUserId: input.actorUserId, action: 'invitation:create', resourceType: 'invitation',
          resourceId: id, outcome: 'allowed',
          detail: { circle: input.circleId, offers: (input.offeredGrants ?? []).length } });
  return { id, token, expiresAt };
}

export type InvitePreview = {
  id: string; circleName: string; inviterName: string; role: string; message: string | null;
  expiresAt: string; offers: { profileName: string; scopeLabel: string; expiresAt: string | null }[];
};

/** Resolves a raw token to a description of what accepting would grant. */
export function previewInvitation(token: string): InvitePreview | null {
  const row = one<Invitation & { circle_name: string; inviter_name: string }>(
    `SELECT i.*, c.name AS circle_name, u.full_name AS inviter_name
     FROM invitations i
     JOIN care_circles c ON c.id = i.circle_id
     JOIN users u ON u.id = i.created_by_user_id
     WHERE i.token_hash = ? AND i.revoked_at IS NULL AND i.accepted_at IS NULL
       AND i.expires_at > ?`,
    tokenHash(token), nowIso(),
  );
  if (!row) return null;
  const offers = (JSON.parse(row.offered_grants) as OfferedGrant[]).flatMap((g) => {
    const p = one<{ display_name: string }>(
      'SELECT display_name FROM care_profiles WHERE id = ? AND deleted_at IS NULL',
      g.careProfileId);
    if (!p || !isScope(g.scope)) return [];
    return [{ profileName: p.display_name, scopeLabel: SCOPE_LABELS[g.scope],
              expiresAt: g.expiresAt ?? null }];
  });
  return {
    id: row.id, circleName: row.circle_name, inviterName: row.inviter_name, role: row.role,
    message: row.message, expiresAt: row.expires_at, offers,
  };
}

export type AcceptResult = { ok: true; circleId: string; grantsApplied: number }
                         | { ok: false; error: string };

/**
 * Accepting is always an explicit action by the invitee. Offered grants are
 * re-checked against current ownership at acceptance time, so an offer made by
 * someone who has since lost control of a profile applies nothing.
 */
export function acceptInvitation(token: string, userId: string): AcceptResult {
  const row = one<Invitation>(
    `SELECT * FROM invitations
     WHERE token_hash = ? AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > ?`,
    tokenHash(token), nowIso(),
  );
  if (!row) {
    audit({ actorUserId: userId, action: 'invitation:accept', outcome: 'denied' });
    return { ok: false, error: 'This invitation link is invalid, already used, or expired.' };
  }
  const invitedEmail = row.invited_email;
  if (invitedEmail) {
    const me = one<{ email: string }>('SELECT email FROM users WHERE id = ?', userId);
    if (me && me.email !== invitedEmail) {
      audit({ actorUserId: userId, action: 'invitation:accept', resourceType: 'invitation',
              resourceId: row.id, outcome: 'denied', detail: { reason: 'email_mismatch' } });
      return { ok: false, error: 'This invitation was addressed to a different email address.' };
    }
  }
  let applied = 0;
  tx((d) => {
    d.prepare('UPDATE invitations SET accepted_at = ?, accepted_by_user_id = ? WHERE id = ?')
      .run(nowIso(), userId, row.id);
    if (!isCircleMember(userId, row.circle_id)) {
      d.prepare('INSERT INTO circle_memberships (id,circle_id,user_id,role,joined_at) VALUES (?,?,?,?,?)')
        .run(newId('mem'), row.circle_id, userId, row.role, nowIso());
    }
  });
  for (const g of JSON.parse(row.offered_grants) as OfferedGrant[]) {
    if (!ownsProfile(row.created_by_user_id, g.careProfileId)) continue;
    if (!isScope(g.scope)) continue;
    try {
      grantAccess({
        careProfileId: g.careProfileId, granteeUserId: userId, scope: g.scope,
        purpose: `Accepted invitation to ${row.circle_id}`, expiresAt: g.expiresAt ?? null,
        grantedByUserId: row.created_by_user_id,
      });
      applied += 1;
    } catch { /* an offer that is no longer valid simply does not apply */ }
  }
  audit({ actorUserId: userId, action: 'invitation:accept', resourceType: 'invitation',
          resourceId: row.id, outcome: 'allowed',
          detail: { circle: row.circle_id, grants_applied: applied } });
  return { ok: true, circleId: row.circle_id, grantsApplied: applied };
}

export function revokeInvitation(actorUserId: string, invitationId: string): void {
  const row = one<{ circle_id: string }>('SELECT circle_id FROM invitations WHERE id = ?', invitationId);
  if (!row) return;
  assertCircleCoordinator(actorUserId, row.circle_id);
  run('UPDATE invitations SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL', nowIso(), invitationId);
  audit({ actorUserId, action: 'invitation:revoke', resourceType: 'invitation',
          resourceId: invitationId, outcome: 'allowed' });
}

export function pendingInvitations(circleId: string) {
  return all<Invitation>(
    `SELECT * FROM invitations
     WHERE circle_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC`,
    circleId, nowIso(),
  );
}

// ------------------------------------------------------- caregiver availability

export function setAvailability(input: {
  userId: string; circleId: string; status: 'available' | 'limited' | 'unavailable';
  fromDate: string; toDate: string; note?: string | null;
}): string {
  assertCircleMember(input.userId, input.circleId);
  const id = newId('avl');
  run(
    `INSERT INTO caregiver_availability (id,user_id,circle_id,status,from_date,to_date,note,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, input.userId, input.circleId, input.status, input.fromDate, input.toDate,
    input.note ?? null, nowIso(),
  );
  return id;
}

export function availabilityFor(circleId: string, onDate?: string) {
  const date = onDate ?? nowIso().slice(0, 10);
  return all<{ user_id: string; full_name: string; status: string; from_date: string;
               to_date: string; note: string | null }>(
    `SELECT a.user_id, u.full_name, a.status, a.from_date, a.to_date, a.note
     FROM caregiver_availability a JOIN users u ON u.id = a.user_id
     WHERE a.circle_id = ? AND a.from_date <= ? AND a.to_date >= ?
     ORDER BY u.full_name`,
    circleId, date, date,
  );
}

export function deleteAvailability(userId: string, id: string): void {
  run('DELETE FROM caregiver_availability WHERE id = ? AND user_id = ?', id, userId);
}
