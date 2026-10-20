import { all, one } from '../db/index.ts';
import { audit } from './audit.ts';
import { nowIso } from './time.ts';

/**
 * THE AUTHORISATION MODEL
 *
 * Every sensitive row belongs to exactly one care_profile. A user may act on a
 * profile only if they own it, or they hold an active access_grant carrying the
 * required scope. Circle membership grants nothing by itself.
 *
 * Call `assertCan` on the server before every read or write of profile-scoped
 * data. Hiding a button is not authorisation.
 */
export const SCOPES = [
  'appointments:view', 'appointments:manage',
  'records:view', 'records:upload',
  'medications:view', 'medications:manage',
  'tasks:view', 'tasks:manage',
  'activity:view',
] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/**
 * Holding the key scope implies the listed scopes.
 * Note what is absent: `records:upload` does NOT imply `records:view`. Being
 * allowed to add a document to someone's vault is not permission to read it.
 */
const IMPLIES: Partial<Record<Scope, Scope[]>> = {
  'appointments:manage': ['appointments:view'],
  'medications:manage': ['medications:view'],
  'tasks:manage': ['tasks:view'],
};

export function expand(scopes: Iterable<Scope>): Set<Scope> {
  const out = new Set<Scope>();
  for (const s of scopes) {
    out.add(s);
    for (const implied of IMPLIES[s] ?? []) out.add(implied);
  }
  return out;
}

export const SCOPE_LABELS: Record<Scope, string> = {
  'appointments:view': 'See appointments',
  'appointments:manage': 'Add and change appointments',
  'records:view': 'Read documents in the Health Vault',
  'records:upload': 'Add documents (without being able to read existing ones)',
  'medications:view': 'See medication schedules and check-ins',
  'medications:manage': 'Add and change medication schedules',
  'tasks:view': 'See care tasks',
  'tasks:manage': 'Create, update and complete care tasks',
  'activity:view': 'See the care activity timeline',
};

export class AuthzError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'AuthzError';
  }
}

export function ownsProfile(userId: string, careProfileId: string): boolean {
  return !!one(
    `SELECT 1 FROM care_profiles
     WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL`,
    careProfileId, userId,
  );
}

/** Active = granted, not revoked, not past its expiry. Checked at query time. */
const ACTIVE_GRANT = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`;

/** Profile-wide scopes this user holds on this profile (excludes per-document grants). */
export function grantedScopes(userId: string, careProfileId: string): Set<Scope> {
  const rows = all<{ scope: string }>(
    `SELECT DISTINCT scope FROM access_grants
     WHERE grantee_user_id = ? AND care_profile_id = ? AND document_id IS NULL AND ${ACTIVE_GRANT}`,
    userId, careProfileId, nowIso(),
  );
  return expand(rows.map((r) => r.scope).filter(isScope));
}

export function can(userId: string, scope: Scope, careProfileId: string): boolean {
  if (ownsProfile(userId, careProfileId)) return true;
  return grantedScopes(userId, careProfileId).has(scope);
}

/** Throws AuthzError and writes a denial to the audit log. Use before every access. */
export function assertCan(
  userId: string, scope: Scope, careProfileId: string, action: string = scope,
): void {
  if (can(userId, scope, careProfileId)) return;
  audit({
    actorUserId: userId, action, careProfileId,
    resourceType: 'care_profile', resourceId: careProfileId,
    outcome: 'denied', detail: { scope },
  });
  throw new AuthzError();
}

/**
 * Profile ids this user may exercise `scope` on. Used to scope list queries so a
 * forgotten per-row check cannot leak anything: the rows are never selected.
 */
export function visibleProfileIds(userId: string, scope: Scope): string[] {
  const owned = all<{ id: string }>(
    `SELECT id FROM care_profiles WHERE owner_user_id = ? AND deleted_at IS NULL`,
    userId,
  ).map((r) => r.id);
  const granted = all<{ care_profile_id: string; scope: string }>(
    `SELECT DISTINCT care_profile_id, scope FROM access_grants
     WHERE grantee_user_id = ? AND document_id IS NULL AND ${ACTIVE_GRANT}`,
    userId, nowIso(),
  );
  const ids = new Set(owned);
  for (const row of granted) {
    if (expand([row.scope].filter(isScope)).has(scope)) ids.add(row.care_profile_id);
  }
  return [...ids];
}

/** SQL fragment + params for `care_profile_id IN (...)`. Returns a never-match when empty. */
export function profileScopeFilter(
  userId: string, scope: Scope, column = 'care_profile_id',
): { sql: string; params: string[] } {
  const ids = visibleProfileIds(userId, scope);
  if (ids.length === 0) return { sql: '1 = 0', params: [] };
  return { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/**
 * Document reads are stricter than the rest of the vault:
 *   - the profile owner always may;
 *   - a profile-wide records:view grant covers 'standard' documents only;
 *   - a 'restricted' document needs a grant naming that document.
 */
export function canReadDocument(userId: string, documentId: string): boolean {
  const doc = one<{ care_profile_id: string; sensitivity: string; owner_user_id: string }>(
    `SELECT d.care_profile_id, d.sensitivity, p.owner_user_id
     FROM medical_documents d
     JOIN care_profiles p ON p.id = d.care_profile_id
     WHERE d.id = ? AND d.deleted_at IS NULL AND p.deleted_at IS NULL`,
    documentId,
  );
  if (!doc) return false;
  if (doc.owner_user_id === userId) return true;

  const perDocument = one(
    `SELECT 1 FROM access_grants
     WHERE grantee_user_id = ? AND document_id = ? AND scope = 'records:view' AND ${ACTIVE_GRANT}`,
    userId, documentId, nowIso(),
  );
  if (perDocument) return true;

  if (doc.sensitivity === 'restricted') return false;
  return grantedScopes(userId, doc.care_profile_id).has('records:view');
}

export function assertCanReadDocument(userId: string, documentId: string): void {
  if (canReadDocument(userId, documentId)) return;
  audit({
    actorUserId: userId, action: 'document:read', resourceType: 'medical_document',
    resourceId: documentId, outcome: 'denied',
  });
  throw new AuthzError();
}

/** Circle membership: lets a user see the roster and listed profile names. Nothing more. */
export function isCircleMember(userId: string, circleId: string): boolean {
  return !!one(
    `SELECT 1 FROM circle_memberships
     WHERE circle_id = ? AND user_id = ? AND removed_at IS NULL`,
    circleId, userId,
  );
}

export function isCircleCoordinator(userId: string, circleId: string): boolean {
  return !!one(
    `SELECT 1 FROM circle_memberships
     WHERE circle_id = ? AND user_id = ? AND role = 'coordinator' AND removed_at IS NULL`,
    circleId, userId,
  );
}

export function assertCircleMember(userId: string, circleId: string): void {
  if (isCircleMember(userId, circleId)) return;
  audit({
    actorUserId: userId, action: 'circle:view', resourceType: 'care_circle',
    resourceId: circleId, outcome: 'denied',
  });
  throw new AuthzError();
}

export function assertCircleCoordinator(userId: string, circleId: string): void {
  if (isCircleCoordinator(userId, circleId)) return;
  audit({
    actorUserId: userId, action: 'circle:manage', resourceType: 'care_circle',
    resourceId: circleId, outcome: 'denied',
  });
  throw new AuthzError('Only a circle coordinator can do that.');
}
