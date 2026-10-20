import { all, one, run, tx } from '../db/index.ts';
import { newId } from './ids.ts';
import { nowIso } from './time.ts';
import { audit, recordActivity } from './audit.ts';
import { AuthzError, assertCan, canReadDocument, profileScopeFilter } from './authz.ts';
import { cancelRemindersFor, scheduleMedicationReminders, scheduleRefillReminder } from './reminders.ts';

/**
 * MEDICATION SAFETY BOUNDARY
 *
 * This module organises instructions that a person has already confirmed. It does
 * not and must not:
 *   - propose a medication, a dose or a frequency;
 *   - change a dose;
 *   - advise what to do about a missed dose;
 *   - check interactions;
 *   - judge adherence.
 *
 * Every schedule records WHO confirmed the instruction and in what capacity
 * (`instruction_source`), and the instruction text is stored verbatim so it can
 * be shown back exactly as given rather than paraphrased.
 */

export const INSTRUCTION_SOURCES = ['clinician_written', 'patient_entered', 'caregiver_entered'] as const;
export type InstructionSource = (typeof INSTRUCTION_SOURCES)[number];

export const SOURCE_LABELS: Record<InstructionSource, string> = {
  clinician_written: 'Copied from a written prescription',
  patient_entered: 'Entered by the person taking it',
  caregiver_entered: 'Entered by an authorised caregiver',
};

export const CHECKIN_STATUSES = ['taken', 'skipped', 'not_confirmed', 'snoozed'] as const;
export type CheckinStatus = (typeof CHECKIN_STATUSES)[number];

export const CHECKIN_LABELS: Record<CheckinStatus, string> = {
  taken: 'Taken — self-reported',
  skipped: 'Skipped — self-reported',
  not_confirmed: 'Not confirmed',
  snoozed: 'Reminder snoozed',
};

export type MedicationSchedule = {
  id: string; care_profile_id: string; profile_name: string; medication_name: string;
  strength: string | null; form: string | null; dose_instruction: string;
  instruction_source: InstructionSource; confirmed_by_name: string; confirmed_at: string;
  prescription_document_id: string | null; start_date: string; end_date: string | null;
  times_of_day: string; days_of_week: string | null; timezone: string;
  refill_reminder_date: string | null; notes: string | null;
  status: 'active' | 'discontinued'; discontinued_at: string | null;
  discontinued_reason: string | null; created_at: string;
};

const SELECT = `
  SELECT m.*, p.display_name AS profile_name, cu.full_name AS confirmed_by_name
  FROM medication_schedules m
  JOIN care_profiles p ON p.id = m.care_profile_id
  JOIN users cu ON cu.id = m.confirmed_by_user_id`;

export function createSchedule(input: {
  actorUserId: string; careProfileId: string; medicationName: string; doseInstruction: string;
  instructionSource: InstructionSource; timesOfDay: string[]; startDate: string; timezone: string;
  strength?: string | null; form?: string | null; endDate?: string | null;
  daysOfWeek?: number[] | null; refillReminderDate?: string | null; notes?: string | null;
  prescriptionDocumentId?: string | null; isDemo?: boolean;
}): string {
  assertCan(input.actorUserId, 'medications:manage', input.careProfileId, 'medication:create');

  if (!input.doseInstruction.trim()) {
    throw new Error('Enter the dose instruction exactly as it was given. This app will not compose one for you.');
  }
  if (input.timesOfDay.length === 0) {
    throw new Error('Add at least one reminder time.');
  }
  for (const t of input.timesOfDay) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`"${t}" is not a valid time.`);
  }
  if (input.prescriptionDocumentId && !canReadDocument(input.actorUserId, input.prescriptionDocumentId)) {
    throw new AuthzError('You cannot attach a prescription you are not allowed to read.');
  }

  const id = newId('med');
  const now = nowIso();
  run(
    `INSERT INTO medication_schedules
     (id, care_profile_id, medication_name, strength, form, dose_instruction,
      instruction_source, confirmed_by_user_id, confirmed_at, prescription_document_id,
      start_date, end_date, times_of_day, days_of_week, timezone, refill_reminder_date,
      notes, status, is_demo, created_by_user_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)`,
    id, input.careProfileId, input.medicationName.trim(), input.strength ?? null,
    input.form ?? null, input.doseInstruction.trim(), input.instructionSource,
    input.actorUserId, now, input.prescriptionDocumentId ?? null, input.startDate,
    input.endDate ?? null, JSON.stringify([...input.timesOfDay].sort()),
    input.daysOfWeek ? JSON.stringify(input.daysOfWeek) : null, input.timezone,
    input.refillReminderDate ?? null, input.notes ?? null, input.isDemo ? 1 : 0,
    input.actorUserId, now, now,
  );
  scheduleMedicationReminders(id);
  scheduleRefillReminder(id);
  audit({ actorUserId: input.actorUserId, action: 'medication:create',
          resourceType: 'medication_schedule', resourceId: id,
          careProfileId: input.careProfileId, outcome: 'allowed',
          detail: { source: input.instructionSource, times: input.timesOfDay.length } });
  recordActivity({
    careProfileId: input.careProfileId, actorUserId: input.actorUserId, kind: 'medication_added',
    summary: `Medication routine added: ${input.medicationName.trim()}`,
    subjectType: 'medication_schedule', subjectId: id, requiredScope: 'medications:view',
  });
  return id;
}

export function listSchedules(userId: string, filter: {
  careProfileId?: string | null; includeDiscontinued?: boolean;
} = {}): MedicationSchedule[] {
  const scope = profileScopeFilter(userId, 'medications:view', 'm.care_profile_id');
  const where = [scope.sql];
  const params: unknown[] = [...scope.params];
  if (filter.careProfileId) { where.push('m.care_profile_id = ?'); params.push(filter.careProfileId); }
  if (!filter.includeDiscontinued) where.push("m.status = 'active'");
  return all<MedicationSchedule>(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY m.status, m.medication_name`, ...params,
  );
}

export function getSchedule(userId: string, id: string): MedicationSchedule | undefined {
  const row = one<MedicationSchedule>(`${SELECT} WHERE m.id = ?`, id);
  if (!row) return undefined;
  assertCan(userId, 'medications:view', row.care_profile_id, 'medication:read');
  return row;
}

export function updateSchedule(input: {
  actorUserId: string; id: string; doseInstruction?: string; instructionSource?: InstructionSource;
  timesOfDay?: string[]; endDate?: string | null; refillReminderDate?: string | null;
  notes?: string | null;
}): void {
  const s = requireManageable(input.actorUserId, input.id);
  // Changing the instruction re-records who confirmed the new wording.
  const changingInstruction = input.doseInstruction !== undefined
    && input.doseInstruction.trim() !== s.dose_instruction;
  run(
    `UPDATE medication_schedules SET
       dose_instruction = COALESCE(?, dose_instruction),
       instruction_source = COALESCE(?, instruction_source),
       times_of_day = COALESCE(?, times_of_day),
       end_date = COALESCE(?, end_date),
       refill_reminder_date = COALESCE(?, refill_reminder_date),
       notes = COALESCE(?, notes),
       confirmed_by_user_id = CASE WHEN ? = 1 THEN ? ELSE confirmed_by_user_id END,
       confirmed_at = CASE WHEN ? = 1 THEN ? ELSE confirmed_at END,
       updated_at = ?
     WHERE id = ?`,
    input.doseInstruction?.trim() ?? null, input.instructionSource ?? null,
    input.timesOfDay ? JSON.stringify([...input.timesOfDay].sort()) : null,
    input.endDate ?? null, input.refillReminderDate ?? null, input.notes ?? null,
    changingInstruction ? 1 : 0, input.actorUserId,
    changingInstruction ? 1 : 0, nowIso(), nowIso(), input.id,
  );
  if (input.timesOfDay) {
    cancelRemindersFor('medication_dose', input.id);
    scheduleMedicationReminders(input.id);
  }
  audit({ actorUserId: input.actorUserId, action: 'medication:update',
          resourceType: 'medication_schedule', resourceId: input.id,
          careProfileId: s.care_profile_id, outcome: 'allowed',
          detail: { instruction_reconfirmed: changingInstruction } });
}

/** Stopping a routine is recorded with a reason; history is never deleted. */
export function discontinueSchedule(actorUserId: string, id: string, reason: string): void {
  const s = requireManageable(actorUserId, id);
  tx((d) => {
    d.prepare(
      `UPDATE medication_schedules SET status = 'discontinued', discontinued_at = ?,
         discontinued_reason = ?, updated_at = ? WHERE id = ?`,
    ).run(nowIso(), reason.trim(), nowIso(), id);
    d.prepare(
      `UPDATE reminders SET status = 'cancelled'
       WHERE subject_type = 'medication_dose' AND subject_id LIKE ? AND status = 'scheduled'`,
    ).run(`${id}:%`);
    // Future slots nobody answered are removed; past ones stay as a record.
    d.prepare(
      `DELETE FROM medication_checkins
       WHERE schedule_id = ? AND scheduled_for > ? AND status = 'not_confirmed'`,
    ).run(id, nowIso());
  });
  cancelRemindersFor('refill', id);
  audit({ actorUserId, action: 'medication:discontinue', resourceType: 'medication_schedule',
          resourceId: id, careProfileId: s.care_profile_id, outcome: 'allowed' });
  recordActivity({
    careProfileId: s.care_profile_id, actorUserId, kind: 'medication_discontinued',
    summary: `Medication routine stopped: ${s.medication_name}`,
    subjectType: 'medication_schedule', subjectId: id, requiredScope: 'medications:view',
  });
}

function requireManageable(userId: string, id: string): MedicationSchedule {
  const row = one<MedicationSchedule>(`${SELECT} WHERE m.id = ?`, id);
  if (!row) throw new AuthzError('That medication routine no longer exists.');
  assertCan(userId, 'medications:manage', row.care_profile_id, 'medication:manage');
  return row;
}

// ------------------------------------------------------------------- check-ins

export type Checkin = {
  id: string; schedule_id: string; scheduled_for: string; status: CheckinStatus;
  reported_by_name: string | null; reported_at: string | null; note: string | null;
  medication_name: string; dose_instruction: string; care_profile_id: string;
  profile_name: string;
};

/**
 * Records what a PERSON reports about a dose. There is no code path anywhere that
 * writes 'taken' or 'skipped' without an explicit user action carrying their id.
 */
export function recordCheckin(input: {
  actorUserId: string; scheduleId: string; scheduledFor: string;
  status: 'taken' | 'skipped' | 'snoozed'; note?: string | null;
}): void {
  const s = one<{ care_profile_id: string; medication_name: string }>(
    'SELECT care_profile_id, medication_name FROM medication_schedules WHERE id = ?',
    input.scheduleId,
  );
  if (!s) throw new Error('That medication routine no longer exists.');
  // Reporting a check-in is a management action: a read-only viewer cannot do it.
  assertCan(input.actorUserId, 'medications:manage', s.care_profile_id, 'medication:checkin');

  run(
    `INSERT INTO medication_checkins
       (id, schedule_id, scheduled_for, status, reported_by_user_id, reported_at, note)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(schedule_id, scheduled_for) DO UPDATE SET
       status = excluded.status, reported_by_user_id = excluded.reported_by_user_id,
       reported_at = excluded.reported_at, note = excluded.note`,
    newId('mck'), input.scheduleId, input.scheduledFor, input.status, input.actorUserId,
    nowIso(), input.note ?? null,
  );
  audit({ actorUserId: input.actorUserId, action: 'medication:checkin',
          resourceType: 'medication_schedule', resourceId: input.scheduleId,
          careProfileId: s.care_profile_id, outcome: 'allowed',
          detail: { status: input.status, slot: input.scheduledFor } });
}

const CHECKIN_SELECT = `
  SELECT c.id, c.schedule_id, c.scheduled_for, c.status, c.reported_at, c.note,
         u.full_name AS reported_by_name, m.medication_name, m.dose_instruction,
         m.care_profile_id, p.display_name AS profile_name
  FROM medication_checkins c
  JOIN medication_schedules m ON m.id = c.schedule_id
  JOIN care_profiles p ON p.id = m.care_profile_id
  LEFT JOIN users u ON u.id = c.reported_by_user_id`;

/** Dose slots in a window, scoped to profiles the caller may see medications for. */
export function checkinsInWindow(
  userId: string, fromIso: string, toIso: string, careProfileId?: string | null,
): Checkin[] {
  const scope = profileScopeFilter(userId, 'medications:view', 'm.care_profile_id');
  const where = [scope.sql, 'c.scheduled_for >= ?', 'c.scheduled_for <= ?'];
  const params: unknown[] = [...scope.params, fromIso, toIso];
  if (careProfileId) { where.push('m.care_profile_id = ?'); params.push(careProfileId); }
  return all<Checkin>(
    `${CHECKIN_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.scheduled_for`, ...params,
  );
}

/** Past slots nobody has answered. Shown as open questions, not as missed doses. */
export function unconfirmedCheckins(userId: string, limit = 20): Checkin[] {
  const scope = profileScopeFilter(userId, 'medications:view', 'm.care_profile_id');
  return all<Checkin>(
    `${CHECKIN_SELECT}
     WHERE ${scope.sql} AND c.status = 'not_confirmed' AND c.scheduled_for <= ?
       AND m.status = 'active'
     ORDER BY c.scheduled_for DESC LIMIT ?`,
    ...scope.params, nowIso(), limit,
  );
}

/**
 * Raw counts of SELF-REPORTED check-ins. Deliberately not an adherence score:
 * this software does not evaluate whether someone is taking medicine correctly.
 */
export function checkinTally(userId: string, scheduleId: string, days = 30) {
  const s = getSchedule(userId, scheduleId);
  if (!s) throw new AuthzError();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = all<{ status: CheckinStatus; n: number }>(
    `SELECT status, count(*) n FROM medication_checkins
     WHERE schedule_id = ? AND scheduled_for >= ? AND scheduled_for <= ?
     GROUP BY status`,
    scheduleId, since, nowIso(),
  );
  const tally: Record<CheckinStatus, number> = {
    taken: 0, skipped: 0, not_confirmed: 0, snoozed: 0,
  };
  for (const r of rows) tally[r.status] = r.n;
  return { days, tally, note: 'Counts of what people reported. This is not a clinical assessment.' };
}

/** Extends dose slots for every active schedule. Called by the scheduler tick. */
export function extendAllSchedules(days = 7): number {
  const ids = all<{ id: string }>("SELECT id FROM medication_schedules WHERE status = 'active'");
  let created = 0;
  for (const s of ids) created += scheduleMedicationReminders(s.id, days);
  return created;
}
