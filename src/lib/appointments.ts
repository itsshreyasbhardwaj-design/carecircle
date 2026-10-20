import { all, one, run, tx } from '../db/index.ts';
import { newId } from './ids.ts';
import { nowIso } from './time.ts';
import { audit, recordActivity } from './audit.ts';
import { AuthzError, assertCan, can, canReadDocument, profileScopeFilter } from './authz.ts';
import { cancelRemindersFor, scheduleAppointmentReminders } from './reminders.ts';

export const APPOINTMENT_STATUSES = [
  'proposed', 'scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  proposed: 'Proposed', scheduled: 'Scheduled', confirmed: 'Confirmed',
  completed: 'Completed', cancelled: 'Cancelled', rescheduled: 'Rescheduled',
};

export type Appointment = {
  id: string; care_profile_id: string; profile_name: string; title: string;
  provider_name: string | null; location: string | null; starts_at: string; timezone: string;
  duration_minutes: number | null; notes: string | null; responsible_user_id: string | null;
  responsible_name: string | null; status: AppointmentStatus; followup_date: string | null;
  outcome_note: string | null; created_at: string; updated_at: string;
  prep_total: number; prep_done: number; document_count: number;
};

const SELECT = `
  SELECT a.*, p.display_name AS profile_name, r.full_name AS responsible_name,
         (SELECT count(*) FROM appointment_prep_items i WHERE i.appointment_id = a.id) AS prep_total,
         (SELECT count(*) FROM appointment_prep_items i WHERE i.appointment_id = a.id AND i.done = 1) AS prep_done,
         (SELECT count(*) FROM appointment_documents ad WHERE ad.appointment_id = a.id) AS document_count
  FROM appointments a
  JOIN care_profiles p ON p.id = a.care_profile_id
  LEFT JOIN users r ON r.id = a.responsible_user_id`;

export function createAppointment(input: {
  actorUserId: string; careProfileId: string; title: string; startsAt: string; timezone: string;
  providerName?: string | null; location?: string | null; durationMinutes?: number | null;
  notes?: string | null; responsibleUserId?: string | null; status?: AppointmentStatus;
  followupDate?: string | null; isDemo?: boolean;
}): string {
  assertCan(input.actorUserId, 'appointments:manage', input.careProfileId, 'appointment:create');
  if (input.responsibleUserId) assertAssignable(input.responsibleUserId, input.careProfileId, 'appointments:view');

  const id = newId('apt');
  const now = nowIso();
  run(
    `INSERT INTO appointments
     (id, care_profile_id, title, provider_name, location, starts_at, timezone,
      duration_minutes, notes, responsible_user_id, status, followup_date, is_demo,
      created_by_user_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.careProfileId, input.title.trim(), input.providerName ?? null,
    input.location ?? null, input.startsAt, input.timezone, input.durationMinutes ?? null,
    input.notes ?? null, input.responsibleUserId ?? null, input.status ?? 'scheduled',
    input.followupDate ?? null, input.isDemo ? 1 : 0, input.actorUserId, now, now,
  );
  scheduleAppointmentReminders(id);
  audit({ actorUserId: input.actorUserId, action: 'appointment:create', resourceType: 'appointment',
          resourceId: id, careProfileId: input.careProfileId, outcome: 'allowed' });
  recordActivity({ careProfileId: input.careProfileId, actorUserId: input.actorUserId,
                   kind: 'appointment_created', summary: `Appointment scheduled: ${input.title}`,
                   subjectType: 'appointment', subjectId: id, requiredScope: 'appointments:view' });
  return id;
}

/**
 * A responsibility can only be handed to someone who can already see the thing
 * they are responsible for. Assignment must never widen access by itself.
 */
export function assertAssignable(
  userId: string, careProfileId: string, scope: 'appointments:view' | 'tasks:view',
): void {
  if (can(userId, scope, careProfileId)) return;
  throw new AuthzError(
    'That person does not have access to this care profile yet. Share the relevant permission first, then assign them.',
  );
}

export function listAppointments(userId: string, filter: {
  careProfileId?: string | null; status?: AppointmentStatus | null; from?: string | null;
  to?: string | null; responsibleUserId?: string | null; limit?: number; offset?: number;
} = {}): Appointment[] {
  const scope = profileScopeFilter(userId, 'appointments:view', 'a.care_profile_id');
  const where = [scope.sql, 'a.deleted_at IS NULL'];
  const params: unknown[] = [...scope.params];
  if (filter.careProfileId) { where.push('a.care_profile_id = ?'); params.push(filter.careProfileId); }
  if (filter.status) { where.push('a.status = ?'); params.push(filter.status); }
  if (filter.from) { where.push('a.starts_at >= ?'); params.push(filter.from); }
  if (filter.to) { where.push('a.starts_at <= ?'); params.push(filter.to); }
  if (filter.responsibleUserId) { where.push('a.responsible_user_id = ?'); params.push(filter.responsibleUserId); }
  params.push(filter.limit ?? 100, filter.offset ?? 0);
  return all<Appointment>(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.starts_at LIMIT ? OFFSET ?`, ...params,
  );
}

export function upcomingAppointments(userId: string, days = 14, limit = 20): Appointment[] {
  return listAppointments(userId, {
    from: nowIso(),
    to: new Date(Date.now() + days * 86_400_000).toISOString(),
    limit,
  }).filter((a) => a.status !== 'cancelled');
}

export function getAppointment(userId: string, id: string): Appointment | undefined {
  const row = one<Appointment>(`${SELECT} WHERE a.id = ? AND a.deleted_at IS NULL`, id);
  if (!row) return undefined;
  assertCan(userId, 'appointments:view', row.care_profile_id, 'appointment:read');
  return row;
}

export function updateAppointment(input: {
  actorUserId: string; id: string; title?: string; providerName?: string | null;
  location?: string | null; notes?: string | null; durationMinutes?: number | null;
  followupDate?: string | null; outcomeNote?: string | null;
}): void {
  const appt = requireManageable(input.actorUserId, input.id);
  run(
    `UPDATE appointments SET
       title = COALESCE(?, title), provider_name = COALESCE(?, provider_name),
       location = COALESCE(?, location), notes = COALESCE(?, notes),
       duration_minutes = COALESCE(?, duration_minutes),
       followup_date = COALESCE(?, followup_date), outcome_note = COALESCE(?, outcome_note),
       updated_at = ?
     WHERE id = ?`,
    input.title ?? null, input.providerName ?? null, input.location ?? null, input.notes ?? null,
    input.durationMinutes ?? null, input.followupDate ?? null, input.outcomeNote ?? null,
    nowIso(), input.id,
  );
  audit({ actorUserId: input.actorUserId, action: 'appointment:update', resourceType: 'appointment',
          resourceId: input.id, careProfileId: appt.care_profile_id, outcome: 'allowed' });
}

/** Rescheduling keeps the original row (status 'rescheduled') and links the new one. */
export function rescheduleAppointment(input: {
  actorUserId: string; id: string; startsAt: string; timezone: string; reason?: string | null;
}): string {
  const appt = requireManageable(input.actorUserId, input.id);
  const newAppointmentId = newId('apt');
  const now = nowIso();
  tx((d) => {
    d.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?')
      .run('rescheduled', now, input.id);
    d.prepare(
      `INSERT INTO appointments
       (id, care_profile_id, title, provider_name, location, starts_at, timezone,
        duration_minutes, notes, responsible_user_id, status, rescheduled_from_id,
        created_by_user_id, created_at, updated_at)
       SELECT ?, care_profile_id, title, provider_name, location, ?, ?, duration_minutes,
              CASE WHEN ? IS NULL THEN notes
                   ELSE COALESCE(notes || char(10), '') || 'Rescheduled: ' || ? END,
              responsible_user_id, 'scheduled', ?, ?, ?, ?
       FROM appointments WHERE id = ?`,
    ).run(newAppointmentId, input.startsAt, input.timezone, input.reason ?? null,
          input.reason ?? '', input.id, input.actorUserId, now, now, input.id);
    // Copy the preparation checklist forward; it is still relevant.
    d.prepare(
      `INSERT INTO appointment_prep_items
       (id, appointment_id, kind, text, source, done, position, created_by_user_id, created_at)
       SELECT lower(hex(randomblob(12))), ?, kind, text, source, 0, position, created_by_user_id, ?
       FROM appointment_prep_items WHERE appointment_id = ?`,
    ).run(newAppointmentId, now, input.id);
  });
  cancelRemindersFor('appointment', input.id);
  scheduleAppointmentReminders(newAppointmentId);
  audit({ actorUserId: input.actorUserId, action: 'appointment:reschedule',
          resourceType: 'appointment', resourceId: input.id,
          careProfileId: appt.care_profile_id, outcome: 'allowed',
          detail: { replacement: newAppointmentId } });
  recordActivity({ careProfileId: appt.care_profile_id, actorUserId: input.actorUserId,
                   kind: 'appointment_rescheduled',
                   summary: `Appointment moved: ${appt.title}`, subjectType: 'appointment',
                   subjectId: newAppointmentId, requiredScope: 'appointments:view' });
  return newAppointmentId;
}

export function setAppointmentStatus(
  actorUserId: string, id: string, status: AppointmentStatus, outcomeNote?: string | null,
): void {
  const appt = requireManageable(actorUserId, id);
  run('UPDATE appointments SET status = ?, outcome_note = COALESCE(?, outcome_note), updated_at = ? WHERE id = ?',
    status, outcomeNote ?? null, nowIso(), id);
  if (status === 'cancelled' || status === 'completed') cancelRemindersFor('appointment', id);
  audit({ actorUserId, action: 'appointment:status', resourceType: 'appointment', resourceId: id,
          careProfileId: appt.care_profile_id, outcome: 'allowed', detail: { status } });
  recordActivity({ careProfileId: appt.care_profile_id, actorUserId, kind: 'appointment_status',
                   summary: `Appointment ${STATUS_LABELS[status].toLowerCase()}: ${appt.title}`,
                   subjectType: 'appointment', subjectId: id, requiredScope: 'appointments:view' });
}

export function assignResponsible(actorUserId: string, id: string, userId: string | null): void {
  const appt = requireManageable(actorUserId, id);
  if (userId) assertAssignable(userId, appt.care_profile_id, 'appointments:view');
  run('UPDATE appointments SET responsible_user_id = ?, updated_at = ? WHERE id = ?',
    userId, nowIso(), id);
  scheduleAppointmentReminders(id);
  audit({ actorUserId, action: 'appointment:assign', resourceType: 'appointment', resourceId: id,
          careProfileId: appt.care_profile_id, outcome: 'allowed', detail: { assignee: userId } });
}

export function deleteAppointment(actorUserId: string, id: string): void {
  const appt = requireManageable(actorUserId, id);
  run('UPDATE appointments SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
  cancelRemindersFor('appointment', id);
  audit({ actorUserId, action: 'appointment:delete', resourceType: 'appointment', resourceId: id,
          careProfileId: appt.care_profile_id, outcome: 'allowed' });
}

function requireManageable(userId: string, id: string): Appointment {
  const row = one<Appointment>(`${SELECT} WHERE a.id = ? AND a.deleted_at IS NULL`, id);
  if (!row) throw new AuthzError('That appointment no longer exists.');
  assertCan(userId, 'appointments:manage', row.care_profile_id, 'appointment:manage');
  return row;
}

// ------------------------------------------------------------ preparation items

export const PREP_KINDS = ['question', 'transport', 'document', 'admin', 'instruction'] as const;
export type PrepKind = (typeof PREP_KINDS)[number];

export const PREP_KIND_LABELS: Record<PrepKind, string> = {
  question: 'Question for the doctor',
  transport: 'Getting there',
  document: 'Bring this document',
  admin: 'Admin to do first',
  instruction: 'Instruction from the clinic',
};

export function addPrepItem(input: {
  actorUserId: string; appointmentId: string; kind: PrepKind; text: string;
  /**
   * 'clinician_provided' must only be set when a person is transcribing what a
   * clinician actually said or wrote. The software never generates one.
   */
  source?: 'user' | 'clinician_provided';
}): string {
  const appt = requireManageable(input.actorUserId, input.appointmentId);
  const id = newId('prp');
  const position = (one<{ n: number }>(
    'SELECT COALESCE(MAX(position),0) + 1 AS n FROM appointment_prep_items WHERE appointment_id = ?',
    input.appointmentId,
  )?.n) ?? 1;
  run(
    `INSERT INTO appointment_prep_items
     (id, appointment_id, kind, text, source, position, created_by_user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, input.appointmentId, input.kind, input.text.trim(), input.source ?? 'user',
    position, input.actorUserId, nowIso(),
  );
  audit({ actorUserId: input.actorUserId, action: 'appointment:prep_add',
          resourceType: 'appointment', resourceId: input.appointmentId,
          careProfileId: appt.care_profile_id, outcome: 'allowed', detail: { kind: input.kind } });
  return id;
}

export function togglePrepItem(actorUserId: string, appointmentId: string, itemId: string, done: boolean): void {
  requireManageable(actorUserId, appointmentId);
  run('UPDATE appointment_prep_items SET done = ? WHERE id = ? AND appointment_id = ?',
    done ? 1 : 0, itemId, appointmentId);
}

export function removePrepItem(actorUserId: string, appointmentId: string, itemId: string): void {
  requireManageable(actorUserId, appointmentId);
  run('DELETE FROM appointment_prep_items WHERE id = ? AND appointment_id = ?', itemId, appointmentId);
}

export function prepItems(userId: string, appointmentId: string) {
  const appt = getAppointment(userId, appointmentId);
  if (!appt) throw new AuthzError();
  return all<{ id: string; kind: PrepKind; text: string; source: string; done: number;
               position: number }>(
    `SELECT id, kind, text, source, done, position FROM appointment_prep_items
     WHERE appointment_id = ? ORDER BY position`,
    appointmentId,
  );
}

/** Links a document to an appointment. Requires read access to that document. */
export function linkDocument(actorUserId: string, appointmentId: string, documentId: string): void {
  requireManageable(actorUserId, appointmentId);
  if (!canReadDocument(actorUserId, documentId)) {
    throw new AuthzError('You cannot attach a document you are not allowed to read.');
  }
  run('INSERT OR IGNORE INTO appointment_documents (appointment_id, document_id, linked_at) VALUES (?,?,?)',
    appointmentId, documentId, nowIso());
}

export function unlinkDocument(actorUserId: string, appointmentId: string, documentId: string): void {
  requireManageable(actorUserId, appointmentId);
  run('DELETE FROM appointment_documents WHERE appointment_id = ? AND document_id = ?',
    appointmentId, documentId);
}

/** Linked documents, filtered to the ones this caller may actually read. */
export function appointmentDocuments(userId: string, appointmentId: string) {
  const rows = all<{ id: string; title: string; category: string; document_date: string | null }>(
    `SELECT d.id, d.title, d.category, d.document_date
     FROM appointment_documents ad JOIN medical_documents d ON d.id = ad.document_id
     WHERE ad.appointment_id = ? AND d.deleted_at IS NULL ORDER BY d.title`,
    appointmentId,
  );
  return rows.filter((r) => canReadDocument(userId, r.id));
}
