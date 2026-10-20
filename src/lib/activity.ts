import { all } from '../db/index.ts';
import { expand, ownsProfile, grantedScopes, type Scope, isScope } from './authz.ts';
import { accessibleProfiles } from './profiles.ts';
import { all as allRows } from '../db/index.ts';

export type ActivityEntry = {
  id: string; care_profile_id: string; profile_name: string; actor_name: string | null;
  kind: string; summary: string; subject_type: string | null; subject_id: string | null;
  required_scope: string; occurred_at: string;
};

/**
 * The family activity timeline, filtered per row. Each entry carries the scope a
 * reader must hold, so one profile's feed can legitimately show different things
 * to different members of the same circle.
 */
export function familyActivity(userId: string, opts: {
  careProfileId?: string | null; limit?: number;
} = {}): ActivityEntry[] {
  const profiles = accessibleProfiles(userId)
    .filter((p) => !opts.careProfileId || p.id === opts.careProfileId);
  if (profiles.length === 0) return [];

  const ids = profiles.map((p) => p.id);
  const rows = all<ActivityEntry>(
    `SELECT a.id, a.care_profile_id, p.display_name AS profile_name, u.full_name AS actor_name,
            a.kind, a.summary, a.subject_type, a.subject_id, a.required_scope, a.occurred_at
     FROM care_activity a
     JOIN care_profiles p ON p.id = a.care_profile_id
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.care_profile_id IN (${ids.map(() => '?').join(',')})
     ORDER BY a.occurred_at DESC LIMIT ?`,
    ...ids, (opts.limit ?? 60) * 3,
  );

  // Cache the scope set per profile so the filter is one lookup per profile.
  const scopesByProfile = new Map<string, Set<Scope>>();
  for (const p of profiles) {
    scopesByProfile.set(
      p.id,
      ownsProfile(userId, p.id)
        ? expand(['appointments:manage', 'records:view', 'records:upload', 'medications:manage',
                  'tasks:manage', 'activity:view'])
        : grantedScopes(userId, p.id),
    );
  }
  return rows
    .filter((r) => {
      if (!isScope(r.required_scope)) return false;
      return scopesByProfile.get(r.care_profile_id)?.has(r.required_scope) ?? false;
    })
    .slice(0, opts.limit ?? 60);
}

/** The signed-in user's own security-relevant history. Not other people's. */
export function myAuditHistory(userId: string, limit = 100) {
  return allRows<{ id: string; action: string; resource_type: string | null;
                   resource_id: string | null; outcome: string; occurred_at: string;
                   profile_name: string | null; detail: string | null }>(
    `SELECT a.id, a.action, a.resource_type, a.resource_id, a.outcome, a.occurred_at, a.detail,
            p.display_name AS profile_name
     FROM audit_events a
     LEFT JOIN care_profiles p ON p.id = a.care_profile_id
     WHERE a.actor_user_id = ?
     ORDER BY a.occurred_at DESC LIMIT ?`,
    userId, limit,
  );
}

/**
 * Who has touched a profile the user owns. Owners are entitled to see access to
 * their own records — that is the point of an audit trail.
 */
export function profileAccessHistory(userId: string, careProfileId: string, limit = 100) {
  if (!ownsProfile(userId, careProfileId)) return [];
  return allRows<{ id: string; action: string; outcome: string; occurred_at: string;
                   actor_name: string | null; resource_type: string | null }>(
    `SELECT a.id, a.action, a.outcome, a.occurred_at, a.resource_type,
            COALESCE(u.full_name, 'removed account') AS actor_name
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.care_profile_id = ?
     ORDER BY a.occurred_at DESC LIMIT ?`,
    careProfileId, limit,
  );
}
