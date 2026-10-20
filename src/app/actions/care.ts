'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { createProfile, deleteProfile, updateProfile } from '@/lib/profiles';
import {
  acceptInvitation, createCircle, createInvitation, deleteAvailability, leaveCircle,
  listProfileInCircle, removeMember, revokeInvitation, setAvailability, setMemberRole,
  unlistProfileFromCircle, type OfferedGrant,
} from '@/lib/circles';
import { grantAccess, revokeGrant } from '@/lib/consent';
import { findUserByEmail } from '@/lib/accounts';
import { isScope, type Scope } from '@/lib/authz';
import {
  availabilitySchema, circleSchema, grantSchema, inviteSchema, profileSchema,
} from '@/lib/validate';
import { bool, done, errorMessage, fail, list, parseOr, safeBack, str, strOrNull } from './shared';

export async function createProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = '/family';
  const input = parseOr(profileSchema, {
    displayName: str(formData, 'displayName'),
    relationship: str(formData, 'relationship'),
    dateOfBirth: str(formData, 'dateOfBirth'),
    bloodGroup: str(formData, 'bloodGroup'),
    notes: str(formData, 'notes'),
    isSelf: bool(formData, 'isSelf'),
  }, back);

  // A profile for someone else is created as a self-managed profile that THEY
  // will control once they have an account. Proxy management of another adult's
  // records, or of a minor's, needs an authorisation workflow this release does
  // not have, so such profiles are marked pending review and stay restricted.
  const kind = bool(formData, 'isDependent') ? 'proxy_pending_review' : 'self_managed';
  let id: string;
  try {
    id = createProfile({
      ownerUserId: user.id, displayName: input.displayName, relationship: input.relationship,
      isSelf: input.isSelf ?? false, dateOfBirth: input.dateOfBirth,
      bloodGroup: input.bloodGroup, notes: input.notes, profileKind: kind,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath('/family');
  revalidatePath('/dashboard');
  redirect(`/profiles/${id}`);
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, 'profileId');
  const back = `/profiles/${id}`;
  const input = parseOr(profileSchema, {
    displayName: str(formData, 'displayName'),
    relationship: str(formData, 'relationship'),
    dateOfBirth: str(formData, 'dateOfBirth'),
    bloodGroup: str(formData, 'bloodGroup'),
    notes: str(formData, 'notes'),
  }, back);
  try {
    updateProfile(user.id, id, {
      displayName: input.displayName, relationship: input.relationship,
      dateOfBirth: input.dateOfBirth, bloodGroup: input.bloodGroup, notes: input.notes,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  done(back, 'Profile updated.');
}

export async function deleteProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  try { deleteProfile(user.id, str(formData, 'profileId')); }
  catch (err) { fail('/family', errorMessage(err)); }
  revalidatePath('/family');
  done('/family', 'Profile removed and all access to it withdrawn.');
}

export async function createCircleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = parseOr(circleSchema, { name: str(formData, 'name') }, '/family');
  let id: string;
  try { id = createCircle(user.id, input.name); }
  catch (err) { fail('/family', errorMessage(err)); }
  revalidatePath('/family');
  redirect(`/family/${id}`);
}

export async function listProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const circleId = str(formData, 'circleId');
  try { listProfileInCircle(user.id, circleId, str(formData, 'profileId')); }
  catch (err) { fail(`/family/${circleId}`, errorMessage(err)); }
  revalidatePath(`/family/${circleId}`);
}

export async function unlistProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const circleId = str(formData, 'circleId');
  try { unlistProfileFromCircle(user.id, circleId, str(formData, 'profileId')); }
  catch (err) { fail(`/family/${circleId}`, errorMessage(err)); }
  revalidatePath(`/family/${circleId}`);
}

/**
 * Builds an invitation. Offered permissions arrive as "profileId:scope" pairs
 * from checkboxes; each is re-checked against the inviter's ownership inside
 * createInvitation.
 */
export async function createInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const circleId = str(formData, 'circleId');
  const back = `/family/${circleId}`;
  const offeredGrants: OfferedGrant[] = [];
  const expiresAt = strOrNull(formData, 'offerExpiresAt');
  for (const pair of list(formData, 'offer')) {
    const [careProfileId, scope] = pair.split('|');
    if (!careProfileId || !scope || !isScope(scope)) continue;
    offeredGrants.push({
      careProfileId, scope: scope as Scope,
      expiresAt: expiresAt ? `${expiresAt}T23:59:59.000Z` : null,
    });
  }
  const input = parseOr(inviteSchema, {
    circleId,
    role: str(formData, 'role') || 'member',
    invitedEmail: str(formData, 'invitedEmail'),
    message: str(formData, 'message'),
    offeredGrants,
  }, back);

  let token: string;
  try {
    const created = createInvitation({
      actorUserId: user.id, circleId: input.circleId,
      role: input.role as 'coordinator' | 'member',
      invitedEmail: input.invitedEmail, message: input.message,
      offeredGrants: input.offeredGrants as OfferedGrant[],
    });
    token = created.token;
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  // The raw token is shown once here so it can be copied; it is not stored.
  redirect(`${back}?invite=${encodeURIComponent(token)}`);
}

export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = str(formData, 'token');
  const result = acceptInvitation(token, user.id);
  if (!result.ok) fail(`/invite/${encodeURIComponent(token)}`, result.error);
  revalidatePath('/family');
  revalidatePath('/dashboard');
  redirect(`/family/${result.circleId}?ok=` +
    encodeURIComponent(`Joined. ${result.grantsApplied} permission(s) were shared with you.`));
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const circleId = str(formData, 'circleId');
  try { revokeInvitation(user.id, str(formData, 'invitationId')); }
  catch (err) { fail(`/family/${circleId}`, errorMessage(err)); }
  revalidatePath(`/family/${circleId}`);
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const circleId = str(formData, 'circleId');
  let revoked = 0;
  try { revoked = removeMember(user.id, circleId, str(formData, 'userId')); }
  catch (err) { fail(`/family/${circleId}`, errorMessage(err)); }
  revalidatePath(`/family/${circleId}`);
  done(`/family/${circleId}`,
    `Member removed and ${revoked} permission(s) on this circle's profiles withdrawn.`);
}

export async function setMemberRoleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const circleId = str(formData, 'circleId');
  const role = str(formData, 'role') === 'coordinator' ? 'coordinator' : 'member';
  try { setMemberRole(user.id, circleId, str(formData, 'userId'), role); }
  catch (err) { fail(`/family/${circleId}`, errorMessage(err)); }
  revalidatePath(`/family/${circleId}`);
}

export async function leaveCircleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const circleId = str(formData, 'circleId');
  try { leaveCircle(user.id, circleId); }
  catch (err) { fail(`/family/${circleId}`, errorMessage(err)); }
  revalidatePath('/family');
  done('/family', 'You left the circle.');
}

export async function setAvailabilityAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const circleId = str(formData, 'circleId');
  const back = `/family/${circleId}`;
  const input = parseOr(availabilitySchema, {
    circleId,
    status: str(formData, 'status'),
    fromDate: str(formData, 'fromDate'),
    toDate: str(formData, 'toDate'),
    note: str(formData, 'note'),
  }, back);
  try {
    setAvailability({
      userId: user.id, circleId: input.circleId,
      status: input.status as 'available' | 'limited' | 'unavailable',
      fromDate: input.fromDate, toDate: input.toDate, note: input.note,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
}

export async function deleteAvailabilityAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  deleteAvailability(user.id, str(formData, 'availabilityId'));
  revalidatePath(`/family/${str(formData, 'circleId')}`);
}

/** Shares one or more permissions on a profile the signed-in user owns. */
export async function grantAccessAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = safeBack(formData, '/settings/access');
  const input = parseOr(grantSchema, {
    careProfileId: str(formData, 'careProfileId'),
    granteeEmail: str(formData, 'granteeEmail'),
    scopes: list(formData, 'scopes'),
    purpose: str(formData, 'purpose'),
    expiresAt: str(formData, 'expiresAt'),
    documentId: str(formData, 'documentId'),
  }, back);

  const grantee = findUserByEmail(input.granteeEmail);
  if (!grantee) {
    fail(back, 'No CareCircle account uses that email address. Ask them to sign up first, then share access.');
  }
  try {
    for (const scope of input.scopes) {
      grantAccess({
        careProfileId: input.careProfileId, granteeUserId: grantee.id, scope: scope as Scope,
        documentId: input.documentId, purpose: input.purpose,
        expiresAt: input.expiresAt ? `${input.expiresAt}T23:59:59.000Z` : null,
        grantedByUserId: user.id,
      });
    }
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  revalidatePath('/settings/access');
  done(back, `Access shared with ${grantee.full_name}.`);
}

export async function revokeGrantAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = safeBack(formData, '/settings/access');
  try { revokeGrant(str(formData, 'grantId'), user.id); }
  catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  revalidatePath('/settings/access');
  done(back, 'Access withdrawn. It stopped working immediately.');
}
