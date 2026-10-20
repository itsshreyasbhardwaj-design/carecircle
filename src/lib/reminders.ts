import { all, one, run } from '../db/index.ts';
import { newId } from './ids.ts';
import { localToUtc, nowIso, utcToLocalParts } from './time.ts';
import { can, type Scope } from './authz.ts';

/**
 * REMINDER LIFECYCLE, and what each state actually proves:
 *   scheduled  — a row exists saying "generate something at this instant".
 *   generated  — the instant passed while the server was running, and a
 *                notification row was created.
 *   delivered  — the notification exists in the app's notification centre. That
 *                is the only delivery this system can evidence. No SMS, email or
 *                push is configured, so none is claimed.
 *   acknowledged — a person pressed a button. Nothing else sets this.
 *
 * Nothing is driven by a wall-clock timer: `tick()` asks for everything already
 * due, so a server that was asleep catches up instead of silently losing reminders.
 */

export type SubjectType =
  | 'appointment' | 'medication_dose' | 'care_task' | 'document_followup' | 'handover' | 'refill';

/** The scope a recipient must still hold for the reminder to be worth sending. */
const SUBJECT_SCOPE: Record<SubjectType, Scope> = {
  appointment: 'appointments:view',
  medication_dose: 'medications:view',
  care_task: 'tasks:view',
  document_followup: 'records:view',
  handover: 'tasks:view',
  refill: 'medications:view',
};

export function notify(input: {
  userId: string; careProfileId?: string | null; kind: string; title: string; body: string;
  link?: string | null; reminderId?: string | null;
}): string {
  const id = newId('ntf');
  run(
    `INSERT INTO notifications
     (id, user_id, reminder_id, care_profile_id, kind, title, body, link, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, input.userId, input.reminderId ?? null, input.careProfileId ?? null, input.kind,
    input.title, input.body, input.link ?? null, nowIso(),
  );
  return id;
}

/** Idempotent: the unique index on (subject, recipient, due_at) absorbs repeats. */
export function scheduleReminder(input: {
  careProfileId: string; subjectType: SubjectType; subjectId: string;
  recipientUserId: string; dueAt: string;
}): void {
  if (new Date(input.dueAt).getTime() < Date.now() - 60_000) return; // don't backfill the past
  run(
    `INSERT OR IGNORE INTO reminders
     (id, care_profile_id, subject_type, subject_id, recipient_user_id, due_at, status, created_at)
     VALUES (?,?,?,?,?,?,'scheduled',?)`,
    newId('rem'), input.careProfileId, input.subjectType, input.subjectId,
    input.recipientUserId, input.dueAt, nowIso(),
  );
}

export function cancelRemindersFor(subjectType: SubjectType, subjectId: string): void {
  run(
    `UPDATE reminders SET status = 'cancelled'
     WHERE subject_type = ? AND subject_id = ? AND status = 'scheduled'`,
    subjectType, subjectId,
  );
}

type Prefs = { reminder_lead_minutes: number; notify_appointments: number;
               notify_medications: number; notify_tasks: number; caregiver_followups: number };

function prefs(userId: string): Prefs {
  return one<Prefs>(
    `SELECT reminder_lead_minutes, notify_appointments, notify_medications, notify_tasks,
            caregiver_followups
     FROM user_settings WHERE user_id = ?`, userId,
  ) ?? { reminder_lead_minutes: 120, notify_appointments: 1, notify_medications: 1,
         notify_tasks: 1, caregiver_followups: 0 };
}

/** Owner plus anyone holding the matching scope who is responsible for the thing. */
function recipientsFor(careProfileId: string, extra: (string | null)[]): string[] {
  const owner = one<{ owner_user_id: string }>(
    'SELECT owner_user_id FROM care_profiles WHERE id = ? AND deleted_at IS NULL', careProfileId,
  );
  const set = new Set<string>();
  if (owner) set.add(owner.owner_user_id);
  for (const u of extra) if (u) set.add(u);
  return [...set];
}

export function scheduleAppointmentReminders(appointmentId: string): void {
  const appt = one<{ id: string; care_profile_id: string; starts_at: string; status: string;
                     responsible_user_id: string | null }>(
    `SELECT id, care_profile_id, starts_at, status, responsible_user_id
     FROM appointments WHERE id = ? AND deleted_at IS NULL`, appointmentId,
  );
  if (!appt || appt.status === 'cancelled' || appt.status === 'completed') return;
  for (const userId of recipientsFor(appt.care_profile_id, [appt.responsible_user_id])) {
    const p = prefs(userId);
    if (!p.notify_appointments) continue;
    const dueAt = new Date(new Date(appt.starts_at).getTime() - p.reminder_lead_minutes * 60_000)
      .toISOString();
    scheduleReminder({
      careProfileId: appt.care_profile_id, subjectType: 'appointment', subjectId: appt.id,
      recipientUserId: userId, dueAt,
    });
  }
}

export function scheduleTaskReminder(taskId: string): void {
  const task = one<{ id: string; care_profile_id: string; due_at: string | null; status: string;
                     assignee_user_id: string | null }>(
    `SELECT id, care_profile_id, due_at, status, assignee_user_id
     FROM care_tasks WHERE id = ? AND deleted_at IS NULL`, taskId,
  );
  if (!task?.due_at || task.status === 'completed' || task.status === 'cancelled') return;
  for (const userId of recipientsFor(task.care_profile_id, [task.assignee_user_id])) {
    const p = prefs(userId);
    if (!p.notify_tasks) continue;
    const dueAt = new Date(new Date(task.due_at).getTime() - p.reminder_lead_minutes * 60_000)
      .toISOString();
    scheduleReminder({
      careProfileId: task.care_profile_id, subjectType: 'care_task', subjectId: task.id,
      recipientUserId: userId, dueAt,
    });
  }
}

/**
 * Creates dose slots and their reminders for the next `days`. Slots exist as
 * 'not_confirmed' check-ins so a missing confirmation is visible as a question,
 * never as an assumption that a dose was taken or missed.
 */
export function scheduleMedicationReminders(scheduleId: string, days = 7): number {
  const s = one<{
    id: string; care_profile_id: string; times_of_day: string; days_of_week: string | null;
    timezone: string; start_date: string; end_date: string | null; status: string;
    medication_name: string;
  }>('SELECT * FROM medication_schedules WHERE id = ?', scheduleId);
  if (!s || s.status !== 'active') return 0;

  const times = JSON.parse(s.times_of_day) as string[];
  const weekdays = s.days_of_week ? (JSON.parse(s.days_of_week) as number[]) : null;
  const recipients = recipientsFor(s.care_profile_id, []);
  let created = 0;

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const date = utcToLocalParts(
      new Date(Date.now() + dayOffset * 86_400_000).toISOString(), s.timezone,
    ).date;
    if (date < s.start_date) continue;
    if (s.end_date && date > s.end_date) break;
    if (weekdays && !weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;

    for (const time of times) {
      const instant = localToUtc(date, time, s.timezone);
      run(
        `INSERT OR IGNORE INTO medication_checkins (id, schedule_id, scheduled_for, status)
         VALUES (?,?,?,'not_confirmed')`,
        newId('mck'), s.id, instant,
      );
      created += 1;
      for (const userId of recipients) {
        const p = prefs(userId);
        if (!p.notify_medications) continue;
        scheduleReminder({
          careProfileId: s.care_profile_id, subjectType: 'medication_dose',
          subjectId: `${s.id}:${instant}`, recipientUserId: userId, dueAt: instant,
        });
      }
    }
  }
  return created;
}

export function scheduleRefillReminder(scheduleId: string): void {
  const s = one<{ id: string; care_profile_id: string; refill_reminder_date: string | null;
                  timezone: string; status: string }>(
    'SELECT id, care_profile_id, refill_reminder_date, timezone, status FROM medication_schedules WHERE id = ?',
    scheduleId,
  );
  if (!s?.refill_reminder_date || s.status !== 'active') return;
  const dueAt = localToUtc(s.refill_reminder_date, '09:00', s.timezone);
  for (const userId of recipientsFor(s.care_profile_id, [])) {
    scheduleReminder({ careProfileId: s.care_profile_id, subjectType: 'refill',
                       subjectId: s.id, recipientUserId: userId, dueAt });
  }
}

export function scheduleDocumentFollowup(
  careProfileId: string, documentId: string, followupDate: string, timezone: string,
): void {
  const dueAt = localToUtc(followupDate, '09:00', timezone);
  for (const userId of recipientsFor(careProfileId, [])) {
    scheduleReminder({ careProfileId, subjectType: 'document_followup', subjectId: documentId,
                       recipientUserId: userId, dueAt });
  }
}

type DueReminder = {
  id: string; care_profile_id: string; subject_type: SubjectType; subject_id: string;
  recipient_user_id: string; due_at: string;
};

/**
 * Generates notifications for everything already due. Safe to call repeatedly and
 * after a restart: it selects by due_at, so nothing is lost while the server is down.
 *
 * Access is re-checked here, not just when the reminder was scheduled. A reminder
 * for a profile whose access was revoked in the meantime is dropped, so a
 * background job can never deliver something the recipient may no longer see.
 */
export function tick(limit = 500): { generated: number; skipped: number } {
  const due = all<DueReminder>(
    `SELECT id, care_profile_id, subject_type, subject_id, recipient_user_id, due_at
     FROM reminders WHERE status = 'scheduled' AND due_at <= ?
     ORDER BY due_at LIMIT ?`,
    nowIso(), limit,
  );
  let generated = 0, skipped = 0;
  for (const r of due) {
    if (!can(r.recipient_user_id, SUBJECT_SCOPE[r.subject_type], r.care_profile_id)) {
      run("UPDATE reminders SET status = 'cancelled' WHERE id = ?", r.id);
      skipped += 1;
      continue;
    }
    const content = describe(r);
    if (!content) {
      run("UPDATE reminders SET status = 'cancelled' WHERE id = ?", r.id);
      skipped += 1;
      continue;
    }
    notify({
      userId: r.recipient_user_id, careProfileId: r.care_profile_id, kind: content.kind,
      title: content.title, body: content.body, link: content.link, reminderId: r.id,
    });
    run("UPDATE reminders SET status = 'generated', generated_at = ? WHERE id = ?", nowIso(), r.id);
    generated += 1;
  }
  return { generated, skipped };
}

/** Administrative wording only. Reminders never restate clinical content. */
function describe(r: DueReminder):
  { kind: string; title: string; body: string; link: string } | null {
  const profile = one<{ display_name: string }>(
    'SELECT display_name FROM care_profiles WHERE id = ?', r.care_profile_id,
  );
  const who = profile?.display_name ?? 'a care profile';

  if (r.subject_type === 'appointment') {
    const a = one<{ title: string; starts_at: string; status: string; location: string | null }>(
      'SELECT title, starts_at, status, location FROM appointments WHERE id = ? AND deleted_at IS NULL',
      r.subject_id,
    );
    if (!a || a.status === 'cancelled') return null;
    return { kind: 'appointment_reminder', title: `Upcoming appointment for ${who}`,
             body: `${a.title}${a.location ? ` at ${a.location}` : ''}`,
             link: `/appointments/${r.subject_id}` };
  }
  if (r.subject_type === 'care_task') {
    const t = one<{ title: string; status: string }>(
      'SELECT title, status FROM care_tasks WHERE id = ? AND deleted_at IS NULL', r.subject_id,
    );
    if (!t || t.status === 'completed' || t.status === 'cancelled') return null;
    return { kind: 'task_reminder', title: `Care task due for ${who}`, body: t.title,
             link: `/tasks/${r.subject_id}` };
  }
  if (r.subject_type === 'medication_dose') {
    const [scheduleId] = r.subject_id.split(':');
    const m = one<{ medication_name: string; dose_instruction: string; status: string }>(
      'SELECT medication_name, dose_instruction, status FROM medication_schedules WHERE id = ?',
      scheduleId,
    );
    if (!m || m.status !== 'active') return null;
    // The instruction is quoted back exactly as a person confirmed it.
    return { kind: 'medication_reminder', title: `Medication time for ${who}`,
             body: `${m.medication_name} — as recorded: "${m.dose_instruction}". Please confirm whether it was taken.`,
             link: '/medications' };
  }
  if (r.subject_type === 'refill') {
    const m = one<{ medication_name: string; status: string }>(
      'SELECT medication_name, status FROM medication_schedules WHERE id = ?', r.subject_id,
    );
    if (!m || m.status !== 'active') return null;
    return { kind: 'refill_reminder', title: `Refill reminder for ${who}`,
             body: `${m.medication_name} may need a refill soon.`, link: '/medications' };
  }
  if (r.subject_type === 'document_followup') {
    const d = one<{ title: string }>(
      'SELECT title FROM medical_documents WHERE id = ? AND deleted_at IS NULL', r.subject_id,
    );
    if (!d) return null;
    return { kind: 'document_followup', title: `Follow-up noted for ${who}`,
             body: `A follow-up date was recorded on "${d.title}".`,
             link: `/records/${r.subject_id}` };
  }
  return null;
}

// ---------------------------------------------------------- notification centre

export type Notification = {
  id: string; kind: string; title: string; body: string; link: string | null;
  created_at: string; read_at: string | null; acknowledged_at: string | null;
  snoozed_until: string | null; profile_name: string | null;
};

export function notifications(userId: string, opts: { includeDismissed?: boolean; limit?: number } = {}) {
  const where = ['n.user_id = ?'];
  const params: unknown[] = [userId];
  if (!opts.includeDismissed) where.push('n.dismissed_at IS NULL');
  where.push('(n.snoozed_until IS NULL OR n.snoozed_until <= ?)');
  params.push(nowIso());
  params.push(opts.limit ?? 50);
  return all<Notification>(
    `SELECT n.id, n.kind, n.title, n.body, n.link, n.created_at, n.read_at, n.acknowledged_at,
            n.snoozed_until, p.display_name AS profile_name
     FROM notifications n LEFT JOIN care_profiles p ON p.id = n.care_profile_id
     WHERE ${where.join(' AND ')}
     ORDER BY n.created_at DESC LIMIT ?`,
    ...params,
  );
}

export function snoozedNotifications(userId: string) {
  return all<Notification>(
    `SELECT n.id, n.kind, n.title, n.body, n.link, n.created_at, n.read_at, n.acknowledged_at,
            n.snoozed_until, p.display_name AS profile_name
     FROM notifications n LEFT JOIN care_profiles p ON p.id = n.care_profile_id
     WHERE n.user_id = ? AND n.dismissed_at IS NULL AND n.snoozed_until > ?
     ORDER BY n.snoozed_until`,
    userId, nowIso(),
  );
}

export function unreadCount(userId: string): number {
  return one<{ n: number }>(
    `SELECT count(*) n FROM notifications
     WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL
       AND (snoozed_until IS NULL OR snoozed_until <= ?)`,
    userId, nowIso(),
  )?.n ?? 0;
}

export function markRead(userId: string, notificationId: string): void {
  run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?',
    nowIso(), notificationId, userId);
}

export function markAllRead(userId: string): void {
  run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), userId);
}

/** An explicit "I have seen and dealt with this". Distinct from merely being read. */
export function acknowledge(userId: string, notificationId: string): void {
  run(
    `UPDATE notifications SET acknowledged_at = COALESCE(acknowledged_at, ?),
       read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?`,
    nowIso(), nowIso(), notificationId, userId,
  );
}

export function dismiss(userId: string, notificationId: string): void {
  run('UPDATE notifications SET dismissed_at = ? WHERE id = ? AND user_id = ?',
    nowIso(), notificationId, userId);
}

export function snooze(userId: string, notificationId: string, minutes: number): void {
  run('UPDATE notifications SET snoozed_until = ? WHERE id = ? AND user_id = ?',
    new Date(Date.now() + minutes * 60_000).toISOString(), notificationId, userId);
}

/** What the reminders page shows: scheduled items that have not fired yet. */
export function upcomingReminders(userId: string, limit = 25) {
  return all<{ id: string; subject_type: string; subject_id: string; due_at: string;
               profile_name: string; status: string }>(
    `SELECT r.id, r.subject_type, r.subject_id, r.due_at, r.status, p.display_name AS profile_name
     FROM reminders r JOIN care_profiles p ON p.id = r.care_profile_id
     WHERE r.recipient_user_id = ? AND r.status = 'scheduled' AND r.due_at > ?
     ORDER BY r.due_at LIMIT ?`,
    userId, nowIso(), limit,
  );
}
