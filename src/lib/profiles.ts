import { all, one, run, tx } from '../db/index.ts';
import { newId } from './ids.ts';
import { nowIso } from './time.ts';
import { audit, recordActivity } from './audit.ts';
import { AuthzError, type Scope, grantedScopes, ownsProfile, visibleProfileIds } from './authz.ts';

export type CareProfile = {
  id: string; owner_user_id: string; display_name: string; relationship: string | null;
  is_self: number; date_of_birth: string | null; blood_group: string | null;
  notes: string | null; profile_kind: 'self_managed' | 'proxy_pending_review';
  is_demo: number; created_at: string; updated_at: string;
};

export function createProfile(input: {
  ownerUserId: string; displayName: string; relationship?: string | null;
  isSelf?: boolean; dateOfBirth?: string | null; bloodGroup?: string | null;
  notes?: string | null; profileKind?: CareProfile['profile_kind']; isDemo?: boolean;
}): string {
  const id = newId('prf');
  const now = nowIso();
  if (input.isSelf) {
    const existing = one('SELECT 1 FROM care_profiles WHERE owner_user_id = ? AND is_self = 1 AND deleted_at IS NULL',
      input.ownerUserId);
    if (existing) throw new Error('You already have a profile for yourself.');
  }
  run(
    `INSERT INTO care_profiles
     (id, owner_user_id, display_name, relationship, is_self, date_of_birth, blood_group,
      notes, profile_kind, is_demo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.ownerUserId, input.displayName.trim(), input.relationship ?? null,
    input.isSelf ? 1 : 0, input.dateOfBirth ?? null, input.bloodGroup ?? null,
    input.notes ?? null, input.profileKind ?? 'self_managed', input.isDemo ? 1 : 0, now, now,
  );
  audit({ actorUserId: input.ownerUserId, action: 'profile:create', resourceType: 'care_profile',
          resourceId: id, careProfileId: id, outcome: 'allowed',
          detail: { kind: input.profileKind ?? 'self_managed' } });
  return id;
}

export function getProfile(id: string): CareProfile | undefined {
  return one<CareProfile>('SELECT * FROM care_profiles WHERE id = ? AND deleted_at IS NULL', id);
}

export function ownedProfiles(userId: string): CareProfile[] {
  return all<CareProfile>(
    `SELECT * FROM care_profiles WHERE owner_user_id = ? AND deleted_at IS NULL
     ORDER BY is_self DESC, display_name`,
    userId,
  );
}

export type AccessibleProfile = CareProfile & { access: 'owner' | 'granted'; scopes: Scope[] };

/** Every profile the user can see at all, with the scopes they hold on each. */
export function accessibleProfiles(userId: string): AccessibleProfile[] {
  const owned = ownedProfiles(userId).map(
    (p): AccessibleProfile => ({
      ...p, access: 'owner',
      scopes: ['appointments:manage', 'records:view', 'records:upload', 'medications:manage',
               'tasks:manage', 'activity:view', 'appointments:view', 'medications:view',
               'tasks:view'],
    }),
  );
  const grantedIds = new Set<string>();
  for (const scope of ['appointments:view', 'records:view', 'medications:view', 'tasks:view',
                        'activity:view'] as Scope[]) {
    for (const id of visibleProfileIds(userId, scope)) grantedIds.add(id);
  }
  const extra: AccessibleProfile[] = [];
  for (const id of grantedIds) {
    if (owned.some((p) => p.id === id)) continue;
    const profile = getProfile(id);
    if (profile) extra.push({ ...profile, access: 'granted', scopes: [...grantedScopes(userId, id)] });
  }
  return [...owned, ...extra.sort((a, b) => a.display_name.localeCompare(b.display_name))];
}

export function updateProfile(
  actorUserId: string, id: string,
  patch: { displayName?: string; relationship?: string | null; dateOfBirth?: string | null;
           bloodGroup?: string | null; notes?: string | null },
): void {
  if (!ownsProfile(actorUserId, id)) {
    audit({ actorUserId, action: 'profile:update', careProfileId: id, outcome: 'denied' });
    throw new AuthzError('Only the person this profile belongs to can change it.');
  }
  run(
    `UPDATE care_profiles SET
       display_name  = COALESCE(?, display_name),
       relationship  = COALESCE(?, relationship),
       date_of_birth = COALESCE(?, date_of_birth),
       blood_group   = COALESCE(?, blood_group),
       notes         = COALESCE(?, notes),
       updated_at    = ?
     WHERE id = ?`,
    patch.displayName ?? null, patch.relationship ?? null, patch.dateOfBirth ?? null,
    patch.bloodGroup ?? null, patch.notes ?? null, nowIso(), id,
  );
  audit({ actorUserId, action: 'profile:update', resourceType: 'care_profile', resourceId: id,
          careProfileId: id, outcome: 'allowed' });
  recordActivity({ careProfileId: id, actorUserId, kind: 'profile_updated',
                   summary: 'Profile details updated', requiredScope: 'activity:view' });
}

/** Soft delete, and every grant on the profile is revoked in the same transaction. */
export function deleteProfile(actorUserId: string, id: string): void {
  if (!ownsProfile(actorUserId, id)) throw new AuthzError();
  tx((d) => {
    d.prepare('UPDATE care_profiles SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(nowIso(), nowIso(), id);
    d.prepare(`UPDATE access_grants SET revoked_at = ?, revoked_by_user_id = ?
               WHERE care_profile_id = ? AND revoked_at IS NULL`)
      .run(nowIso(), actorUserId, id);
  });
  audit({ actorUserId, action: 'profile:delete', resourceType: 'care_profile', resourceId: id,
          careProfileId: id, outcome: 'allowed' });
}
