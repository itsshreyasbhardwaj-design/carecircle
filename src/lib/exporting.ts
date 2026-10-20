import { all, one } from '../db/index.ts';
import { audit } from './audit.ts';
import { nowIso } from './time.ts';
import { ownedProfiles } from './profiles.ts';
import { listDocuments } from './documents.ts';
import { listAppointments } from './appointments.ts';
import { listTasks } from './tasks.ts';
import { listSchedules, checkinsInWindow } from './medications.ts';
import { grantsGivenBy, grantsHeldBy, consentHistory } from './consent.ts';
import { circlesFor } from './circles.ts';
import { myAuditHistory } from './activity.ts';
import { notifications } from './reminders.ts';

/**
 * Data export. Includes the account's own information and everything on the
 * profiles it owns, plus a list of what others have shared with it — never the
 * contents of someone else's records.
 *
 * Export is never gated on a plan: withdrawing from a product must not require
 * paying for it.
 */
export function exportUserData(userId: string): Record<string, unknown> {
  const user = one<{ id: string; email: string; full_name: string; created_at: string;
                     onboarding_completed_at: string | null }>(
    'SELECT id, email, full_name, created_at, onboarding_completed_at FROM users WHERE id = ?',
    userId,
  );
  const settings = one('SELECT * FROM user_settings WHERE user_id = ?', userId);
  const profiles = ownedProfiles(userId);

  const payload = {
    export: {
      generatedAt: nowIso(),
      product: 'CareCircle',
      formatVersion: 1,
      note: 'Original document files are not inside this JSON. Download each one from the Health Vault, or use the "documents" list below for their identifiers.',
    },
    account: user,
    settings,
    sessions: all(
      `SELECT id, created_at, expires_at, last_seen_at, revoked_at, label
       FROM sessions WHERE user_id = ?`, userId,
    ),
    careProfilesIOwn: profiles,
    circles: circlesFor(userId),
    documents: listDocuments(userId, { limit: 10_000 }).map((d) => ({
      id: d.id, title: d.title, category: d.category, documentDate: d.document_date,
      provider: d.provider_name, notes: d.notes, tags: safeJson(d.tags),
      sensitivity: d.sensitivity, profile: d.profile_name, versions: d.version_count,
      createdAt: d.created_at,
    })),
    documentVersions: profiles.length
      ? all(
          `SELECT v.id, v.document_id, v.version_number, v.original_filename, v.mime_type,
                  v.byte_size, v.sha256, v.created_at
           FROM document_versions v
           JOIN medical_documents d ON d.id = v.document_id
           WHERE d.care_profile_id IN (${profiles.map(() => '?').join(',')})`,
          ...profiles.map((p) => p.id),
        )
      : [],
    appointments: listAppointments(userId, { limit: 10_000 }),
    tasks: listTasks(userId, { limit: 10_000 }),
    medicationSchedules: listSchedules(userId, { includeDiscontinued: true }),
    medicationCheckins: checkinsInWindow(
      userId, new Date(Date.now() - 365 * 86_400_000).toISOString(),
      new Date(Date.now() + 30 * 86_400_000).toISOString(),
    ),
    accessIHaveGranted: grantsGivenBy(userId),
    accessGrantedToMe: grantsHeldBy(userId),
    consentHistory: profiles.flatMap((p) =>
      consentHistory(p.id, 1000).map((c) => ({ ...c, profile: p.display_name }))),
    notifications: notifications(userId, { includeDismissed: true, limit: 1000 }),
    myActivityLog: myAuditHistory(userId, 1000),
  };

  audit({ actorUserId: userId, action: 'account:export', outcome: 'allowed',
          detail: { profiles: profiles.length, documents: payload.documents.length } });
  return payload;
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}
