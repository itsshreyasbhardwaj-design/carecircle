import { beforeEach, describe, expect, it } from 'vitest';
import { makeProfile, makeUser, resetDb } from './helpers.ts';
import {
  acceptInvitation, availabilityFor, circleProfiles, circlesFor, createCircle, createInvitation,
  leaveCircle, listProfileInCircle, members, pendingInvitations, previewInvitation, removeMember,
  revokeInvitation, setAvailability, setMemberRole, unlistProfileFromCircle,
} from '../src/lib/circles.ts';
import { AuthzError, can, isCircleCoordinator, isCircleMember } from '../src/lib/authz.ts';
import { grantsHeldBy } from '../src/lib/consent.ts';
import { all, one, run } from '../src/db/index.ts';
import { tokenHash } from '../src/lib/crypto.ts';
import { todayInZone } from '../src/lib/time.ts';

describe('family circles and invitations', () => {
  beforeEach(resetDb);

  it('the creator becomes the coordinator', () => {
    const user = makeUser();
    const circle = createCircle(user.id, 'The Sharmas');
    expect(isCircleCoordinator(user.id, circle)).toBe(true);
    expect(circlesFor(user.id)[0]?.name).toBe('The Sharmas');
  });

  it('an invitation token is never stored in readable form', () => {
    const owner = makeUser();
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({
      actorUserId: owner.id, circleId: circle, role: 'member',
    });
    const stored = all<{ token_hash: string }>('SELECT token_hash FROM invitations');
    expect(stored[0]?.token_hash).not.toBe(token);
    expect(stored[0]?.token_hash).toBe(tokenHash(token));
    // The token is long and unguessable.
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('describes exactly what accepting will share, before accepting', () => {
    const owner = makeUser('Asha');
    const invitee = makeUser('Priya');
    const profile = makeProfile(owner.id, 'Asha Verma');
    const circle = createCircle(owner.id, "Asha's care");
    const { token } = createInvitation({
      actorUserId: owner.id, circleId: circle, role: 'member',
      offeredGrants: [{ careProfileId: profile, scope: 'appointments:view' }],
      message: 'Helping with appointments',
    });
    const preview = previewInvitation(token)!;
    expect(preview.circleName).toBe("Asha's care");
    expect(preview.inviterName).toBe('Asha');
    expect(preview.offers).toEqual([
      { profileName: 'Asha Verma', scopeLabel: 'See appointments', expiresAt: null },
    ]);
    // Previewing changes nothing.
    expect(isCircleMember(invitee.id, circle)).toBe(false);
    expect(can(invitee.id, 'appointments:view', profile)).toBe(false);
  });

  it('accepting joins the roster and applies the offered grants', () => {
    const owner = makeUser();
    const invitee = makeUser();
    const profile = makeProfile(owner.id);
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({
      actorUserId: owner.id, circleId: circle, role: 'member',
      offeredGrants: [
        { careProfileId: profile, scope: 'appointments:view' },
        { careProfileId: profile, scope: 'tasks:manage' },
      ],
    });
    const result = acceptInvitation(token, invitee.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grantsApplied).toBe(2);
    expect(isCircleMember(invitee.id, circle)).toBe(true);
    expect(can(invitee.id, 'appointments:view', profile)).toBe(true);
    expect(can(invitee.id, 'tasks:manage', profile)).toBe(true);
    // Nothing beyond what was offered.
    expect(can(invitee.id, 'records:view', profile)).toBe(false);
  });

  it('an invitation works once and then not again', () => {
    const owner = makeUser();
    const first = makeUser();
    const second = makeUser();
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    expect(acceptInvitation(token, first.id).ok).toBe(true);
    const reuse = acceptInvitation(token, second.id);
    expect(reuse.ok).toBe(false);
    expect(isCircleMember(second.id, circle)).toBe(false);
  });

  it('rejects an expired, revoked or forged token', () => {
    const owner = makeUser();
    const invitee = makeUser();
    const circle = createCircle(owner.id, 'Family');

    const expired = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    run('UPDATE invitations SET expires_at = ? WHERE id = ?',
        new Date(Date.now() - 1000).toISOString(), expired.id);
    expect(previewInvitation(expired.token)).toBeNull();
    expect(acceptInvitation(expired.token, invitee.id).ok).toBe(false);

    const revoked = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    revokeInvitation(owner.id, revoked.id);
    expect(acceptInvitation(revoked.token, invitee.id).ok).toBe(false);

    expect(acceptInvitation('a-made-up-token-value', invitee.id).ok).toBe(false);
    expect(previewInvitation('another-made-up-token')).toBeNull();
  });

  it('an email-addressed invitation only works for that address', () => {
    const owner = makeUser();
    const wrongPerson = makeUser();
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({
      actorUserId: owner.id, circleId: circle, role: 'member',
      invitedEmail: 'someone.else@example.test',
    });
    const result = acceptInvitation(token, wrongPerson.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/different email/i);
  });

  it('only a coordinator can invite, and only for profiles they own', () => {
    const owner = makeUser();
    const member = makeUser();
    const otherOwner = makeUser();
    const othersProfile = makeProfile(otherOwner.id);
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    acceptInvitation(token, member.id);

    expect(() => createInvitation({ actorUserId: member.id, circleId: circle, role: 'member' }))
      .toThrow(AuthzError);
    expect(() =>
      createInvitation({
        actorUserId: owner.id, circleId: circle, role: 'member',
        offeredGrants: [{ careProfileId: othersProfile, scope: 'records:view' }],
      }),
    ).toThrow(AuthzError);
  });

  it('an offer stops applying if the inviter no longer owns the profile', () => {
    const owner = makeUser();
    const invitee = makeUser();
    const profile = makeProfile(owner.id, 'Parent', false);
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({
      actorUserId: owner.id, circleId: circle, role: 'member',
      offeredGrants: [{ careProfileId: profile, scope: 'records:view' }],
    });
    // The profile goes away between the offer and the acceptance.
    run('UPDATE care_profiles SET deleted_at = ? WHERE id = ?', new Date().toISOString(), profile);
    const result = acceptInvitation(token, invitee.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grantsApplied).toBe(0);
    expect(can(invitee.id, 'records:view', profile)).toBe(false);
  });

  it('listing a profile in a circle shares the name and nothing else', () => {
    const owner = makeUser();
    const member = makeUser();
    const profile = makeProfile(owner.id, 'Asha Verma');
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    acceptInvitation(token, member.id);
    listProfileInCircle(owner.id, circle, profile);

    expect(circleProfiles(circle).map((p) => p.display_name)).toEqual(['Asha Verma']);
    expect(can(member.id, 'records:view', profile)).toBe(false);
    expect(can(member.id, 'appointments:view', profile)).toBe(false);
    expect(can(member.id, 'tasks:view', profile)).toBe(false);
  });

  it('you cannot list a profile you do not control', () => {
    const owner = makeUser();
    const other = makeUser();
    const othersProfile = makeProfile(other.id);
    const circle = createCircle(owner.id, 'Family');
    expect(() => listProfileInCircle(owner.id, circle, othersProfile)).toThrow(AuthzError);
  });

  it('removing a member also withdraws what the circle granted them', () => {
    const owner = makeUser();
    const member = makeUser();
    const profile = makeProfile(owner.id);
    const circle = createCircle(owner.id, 'Family');
    listProfileInCircle(owner.id, circle, profile);
    const { token } = createInvitation({
      actorUserId: owner.id, circleId: circle, role: 'member',
      offeredGrants: [
        { careProfileId: profile, scope: 'records:view' },
        { careProfileId: profile, scope: 'tasks:manage' },
      ],
    });
    acceptInvitation(token, member.id);
    expect(grantsHeldBy(member.id).length).toBe(2);

    const revoked = removeMember(owner.id, circle, member.id);
    expect(revoked).toBe(2);
    expect(isCircleMember(member.id, circle)).toBe(false);
    expect(can(member.id, 'records:view', profile)).toBe(false);
    expect(grantsHeldBy(member.id).length).toBe(0);
    // And the withdrawal is in the ledger.
    expect(all("SELECT 1 FROM consent_records WHERE action = 'revoked'").length).toBe(2);
  });

  it('a plain member cannot remove anyone, and nobody can remove themselves this way', () => {
    const owner = makeUser();
    const member = makeUser();
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    acceptInvitation(token, member.id);

    expect(() => removeMember(member.id, circle, owner.id)).toThrow(AuthzError);
    expect(() => removeMember(owner.id, circle, owner.id)).toThrow(/leave circle/i);
  });

  it('the last coordinator cannot leave', () => {
    const owner = makeUser();
    const member = makeUser();
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    acceptInvitation(token, member.id);

    expect(() => leaveCircle(owner.id, circle)).toThrow(/another coordinator/i);
    setMemberRole(owner.id, circle, member.id, 'coordinator');
    leaveCircle(owner.id, circle);
    expect(isCircleMember(owner.id, circle)).toBe(false);
  });

  it('leaving unlists the leaver\'s own profiles', () => {
    const owner = makeUser();
    const member = makeUser();
    const memberProfile = makeProfile(member.id);
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    acceptInvitation(token, member.id);
    listProfileInCircle(member.id, circle, memberProfile);
    expect(circleProfiles(circle).length).toBe(1);

    leaveCircle(member.id, circle);
    expect(circleProfiles(circle).length).toBe(0);
  });

  it('a non-member sees nothing of a circle', () => {
    const owner = makeUser();
    const outsider = makeUser();
    const circle = createCircle(owner.id, 'Family');
    expect(isCircleMember(outsider.id, circle)).toBe(false);
    expect(circlesFor(outsider.id).length).toBe(0);
    expect(() => setAvailability({
      userId: outsider.id, circleId: circle, status: 'unavailable',
      fromDate: '2026-05-01', toDate: '2026-05-02',
    })).toThrow(AuthzError);
  });

  it('records caregiver availability for a date range', () => {
    const owner = makeUser('Priya');
    const circle = createCircle(owner.id, 'Family');
    const today = todayInZone('Asia/Kolkata');
    setAvailability({
      userId: owner.id, circleId: circle, status: 'unavailable',
      fromDate: today, toDate: today, note: 'Work trip',
    });
    const rows = availabilityFor(circle, today);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('unavailable');
    expect(availabilityFor(circle, '2000-01-01').length).toBe(0);
  });

  it('pending invitations are only listed while they are usable', () => {
    const owner = makeUser();
    const circle = createCircle(owner.id, 'Family');
    const inv = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    expect(pendingInvitations(circle).length).toBe(1);
    revokeInvitation(owner.id, inv.id);
    expect(pendingInvitations(circle).length).toBe(0);
  });

  it('unlisting removes a profile from the circle view', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const circle = createCircle(owner.id, 'Family');
    listProfileInCircle(owner.id, circle, profile);
    unlistProfileFromCircle(owner.id, circle, profile);
    expect(circleProfiles(circle).length).toBe(0);
    expect(one('SELECT 1 FROM care_profiles WHERE id = ?', profile)).toBeTruthy(); // not deleted
  });

  it('lists the roster with roles', () => {
    const owner = makeUser('Asha');
    const member = makeUser('Priya');
    const circle = createCircle(owner.id, 'Family');
    const { token } = createInvitation({ actorUserId: owner.id, circleId: circle, role: 'member' });
    acceptInvitation(token, member.id);
    const roster = members(circle);
    expect(roster.length).toBe(2);
    expect(roster.find((m) => m.full_name === 'Asha')?.role).toBe('coordinator');
    expect(roster.find((m) => m.full_name === 'Priya')?.role).toBe('member');
  });
});
