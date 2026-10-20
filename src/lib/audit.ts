import { newId } from './ids.ts';
import { nowIso } from './time.ts';
import { db } from '../db/index.ts';

export type AuditOutcome = 'allowed' | 'denied';

export type AuditInput = {
  actorUserId: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  careProfileId?: string | null;
  outcome: AuditOutcome;
  ipHash?: string | null;
  /** Identifiers, counts and enum values only. Never health content. */
  detail?: Record<string, string | number | boolean | null> | null;
};

// Keys that would smuggle health content into the audit log.
const FORBIDDEN_DETAIL_KEYS = /^(text|body|notes|content|extracted|dose|instruction|summary)$/i;

export function audit(input: AuditInput): void {
  let detail: string | null = null;
  if (input.detail) {
    for (const key of Object.keys(input.detail)) {
      if (FORBIDDEN_DETAIL_KEYS.test(key)) {
        throw new Error(
          `audit detail may not carry health content (offending key: "${key}")`,
        );
      }
    }
    detail = JSON.stringify(input.detail);
  }
  db()
    .prepare(
      `INSERT INTO audit_events
       (id, actor_user_id, action, resource_type, resource_id, care_profile_id,
        outcome, ip_hash, detail, occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      newId('aud'), input.actorUserId, input.action,
      input.resourceType ?? null, input.resourceId ?? null, input.careProfileId ?? null,
      input.outcome, input.ipHash ?? null, detail, nowIso(),
    );
}

export type ActivityInput = {
  careProfileId: string;
  actorUserId: string | null;
  kind: string;
  /** Administrative wording. "Lab report added", not the report's findings. */
  summary: string;
  subjectType?: string | null;
  subjectId?: string | null;
  /** Readers must hold this scope on the profile to see the entry. */
  requiredScope: string;
};

export function recordActivity(input: ActivityInput): void {
  db()
    .prepare(
      `INSERT INTO care_activity
       (id, care_profile_id, actor_user_id, kind, summary, subject_type, subject_id,
        required_scope, occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      newId('act'), input.careProfileId, input.actorUserId, input.kind, input.summary,
      input.subjectType ?? null, input.subjectId ?? null, input.requiredScope, nowIso(),
    );
}
