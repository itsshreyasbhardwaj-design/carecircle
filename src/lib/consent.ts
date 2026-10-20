import { all, one, run, tx } from '../db/index.ts';
import { newId } from './ids.ts';
import { nowIso } from './time.ts';
import { audit, recordActivity } from './audit.ts';
import { AuthzError, SCOPE_LABELS, type Scope, isScope, ownsProfile } from './authz.ts';

/**
 * Consent lives in two tables: access_grants is the live state the authorisation
 * check reads, consent_records is an append-only ledger of every transition.
 * Revoking writes to both, in one transaction, so the server stops honouring the
 * grant at the same moment the ledger records it.
 */

export type GrantInput = {
  careProfileId: string;
  granteeUserId: string;
  scope: Scope;
  /** Set to limit the grant to one document. */
  documentId?: string | null;
  purpose: string;
  expiresAt?: string | null;
  grantedByUserId: string;
};

export function grantAccess(input: GrantInput): string {
  // Only the person who controls the profile may widen access to it.
  if (!ownsProfile(input.grantedByUserId, input.careProfileId)) {
    audit({
      actorUserId: input.grantedByUserId, action: 'grant:create',
      careProfileId: input.careProfileId, outcome: 'denied', detail: { scope: input.scope },
    });
    throw new AuthzError('Only the person this profile belongs to can share access to it.');
  }
  if (input.granteeUserId === input.grantedByUserId) {
    throw new AuthzError('You already control this profile.');
  }
  const id = newId('grn');
  const now = nowIso();
  tx((d) => {
    // Re-granting an identical scope refreshes purpose and expiry rather than
    // creating a second row (the partial unique index would reject it anyway).
    const existing = d
      .prepare(
        `SELECT id FROM access_grants
         WHERE care_profile_id = ? AND grantee_user_id = ? AND scope = ?
           AND COALESCE(document_id,'') = COALESCE(?,'') AND revoked_at IS NULL`,
      )
      .get(input.careProfileId, input.granteeUserId, input.scope, input.documentId ?? null) as
      | { id: string } | undefined;

    const grantId = existing?.id ?? id;
    if (existing) {
      d.prepare('UPDATE access_grants SET purpose = ?, expires_at = ? WHERE id = ?')
        .run(input.purpose, input.expiresAt ?? null, grantId);
    } else {
      d.prepare(
        `INSERT INTO access_grants
         (id, care_profile_id, grantee_user_id, scope, document_id, granted_by_user_id,
          purpose, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(grantId, input.careProfileId, input.granteeUserId, input.scope,
            input.documentId ?? null, input.grantedByUserId, input.purpose, now,
            input.expiresAt ?? null);
    }
    d.prepare(
      `INSERT INTO consent_records
       (id, access_grant_id, care_profile_id, grantee_user_id, scope, document_id,
        action, purpose, actor_user_id, expires_at, occurred_at)
       VALUES (?,?,?,?,?,?,'granted',?,?,?,?)`,
    ).run(newId('con'), grantId, input.careProfileId, input.granteeUserId, input.scope,
          input.documentId ?? null, input.purpose, input.grantedByUserId,
          input.expiresAt ?? null, now);
  });
  audit({
    actorUserId: input.grantedByUserId, action: 'grant:create', resourceType: 'access_grant',
    resourceId: id, careProfileId: input.careProfileId, outcome: 'allowed',
    detail: { scope: input.scope, grantee: input.granteeUserId, scoped_to_document: !!input.documentId },
  });
  recordActivity({
    careProfileId: input.careProfileId, actorUserId: input.grantedByUserId,
    kind: 'access_granted', summary: `Access shared: ${SCOPE_LABELS[input.scope]}`,
    subjectType: 'access_grant', subjectId: id, requiredScope: 'activity:view',
  });
  return id;
}

export function revokeGrant(grantId: string, actorUserId: string): void {
  const grant = one<{
    care_profile_id: string; grantee_user_id: string; scope: string; document_id: string | null;
    purpose: string;
  }>(
    `SELECT care_profile_id, grantee_user_id, scope, document_id, purpose
     FROM access_grants WHERE id = ? AND revoked_at IS NULL`,
    grantId,
  );
  if (!grant) throw new AuthzError('That access grant no longer exists.');
  // The profile owner may revoke; so may the person who holds it (giving it up).
  const isOwner = ownsProfile(actorUserId, grant.care_profile_id);
  if (!isOwner && grant.grantee_user_id !== actorUserId) {
    audit({
      actorUserId, action: 'grant:revoke', resourceType: 'access_grant', resourceId: grantId,
      careProfileId: grant.care_profile_id, outcome: 'denied',
    });
    throw new AuthzError();
  }
  const now = nowIso();
  tx((d) => {
    d.prepare('UPDATE access_grants SET revoked_at = ?, revoked_by_user_id = ? WHERE id = ?')
      .run(now, actorUserId, grantId);
    d.prepare(
      `INSERT INTO consent_records
       (id, access_grant_id, care_profile_id, grantee_user_id, scope, document_id,
        action, purpose, actor_user_id, occurred_at)
       VALUES (?,?,?,?,?,?,'revoked',?,?,?)`,
    ).run(newId('con'), grantId, grant.care_profile_id, grant.grantee_user_id, grant.scope,
          grant.document_id, grant.purpose, actorUserId, now);
  });
  audit({
    actorUserId, action: 'grant:revoke', resourceType: 'access_grant', resourceId: grantId,
    careProfileId: grant.care_profile_id, outcome: 'allowed', detail: { scope: grant.scope },
  });
  if (isScope(grant.scope)) {
    recordActivity({
      careProfileId: grant.care_profile_id, actorUserId,
      kind: 'access_revoked', summary: `Access withdrawn: ${SCOPE_LABELS[grant.scope]}`,
      subjectType: 'access_grant', subjectId: grantId, requiredScope: 'activity:view',
    });
  }
}

/**
 * Moves lapsed grants into the ledger as 'expired'. The authorisation check
 * already ignores them by comparing expires_at at query time, so this is
 * bookkeeping, not enforcement — enforcement must never depend on a sweep running.
 */
export function sweepExpiredGrants(): number {
  const now = nowIso();
  const lapsed = all<{
    id: string; care_profile_id: string; grantee_user_id: string; scope: string;
    document_id: string | null; purpose: string; expires_at: string;
  }>(
    `SELECT g.id, g.care_profile_id, g.grantee_user_id, g.scope, g.document_id, g.purpose,
            g.expires_at
     FROM access_grants g
     WHERE g.revoked_at IS NULL AND g.expires_at IS NOT NULL AND g.expires_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM consent_records c
         WHERE c.access_grant_id = g.id AND c.action = 'expired')`,
    now,
  );
  for (const g of lapsed) {
    run(
      `INSERT INTO consent_records
       (id, access_grant_id, care_profile_id, grantee_user_id, scope, document_id,
        action, purpose, actor_user_id, expires_at, occurred_at)
       VALUES (?,?,?,?,?,?,'expired',?,NULL,?,?)`,
      newId('con'), g.id, g.care_profile_id, g.grantee_user_id, g.scope, g.document_id,
      g.purpose, g.expires_at, now,
    );
  }
  return lapsed.length;
}

export type GrantRow = {
  id: string; scope: Scope; purpose: string; created_at: string; expires_at: string | null;
  document_id: string | null; grantee_user_id: string; grantee_name: string;
  grantee_email: string; care_profile_id: string; profile_name: string;
  document_title: string | null;
};

/** Grants the user has handed out on profiles they own. */
export function grantsGivenBy(ownerUserId: string): GrantRow[] {
  return all<GrantRow>(
    `SELECT g.id, g.scope, g.purpose, g.created_at, g.expires_at, g.document_id,
            g.grantee_user_id, u.full_name AS grantee_name, u.email AS grantee_email,
            g.care_profile_id, p.display_name AS profile_name, d.title AS document_title
     FROM access_grants g
     JOIN care_profiles p ON p.id = g.care_profile_id
     JOIN users u ON u.id = g.grantee_user_id
     LEFT JOIN medical_documents d ON d.id = g.document_id
     WHERE p.owner_user_id = ? AND g.revoked_at IS NULL
     ORDER BY p.display_name, g.scope`,
    ownerUserId,
  );
}

/** Grants the user currently holds on other people's profiles. */
export function grantsHeldBy(userId: string): GrantRow[] {
  return all<GrantRow>(
    `SELECT g.id, g.scope, g.purpose, g.created_at, g.expires_at, g.document_id,
            g.grantee_user_id, u.full_name AS grantee_name, u.email AS grantee_email,
            g.care_profile_id, p.display_name AS profile_name, d.title AS document_title
     FROM access_grants g
     JOIN care_profiles p ON p.id = g.care_profile_id
     JOIN users u ON u.id = p.owner_user_id
     LEFT JOIN medical_documents d ON d.id = g.document_id
     WHERE g.grantee_user_id = ? AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > ?)
     ORDER BY p.display_name, g.scope`,
    userId, nowIso(),
  );
}

export function consentHistory(careProfileId: string, limit = 100) {
  return all<{
    id: string; action: string; scope: string; purpose: string; occurred_at: string;
    grantee_name: string; expires_at: string | null;
  }>(
    `SELECT c.id, c.action, c.scope, c.purpose, c.occurred_at, c.expires_at,
            COALESCE(u.full_name, 'removed account') AS grantee_name
     FROM consent_records c
     LEFT JOIN users u ON u.id = c.grantee_user_id
     WHERE c.care_profile_id = ?
     ORDER BY c.occurred_at DESC LIMIT ?`,
    careProfileId, limit,
  );
}
