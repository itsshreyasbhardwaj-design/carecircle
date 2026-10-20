import { beforeEach, describe, expect, it } from 'vitest';
import { makeProfile, makeUser, resetDb } from './helpers.ts';
import {
  acknowledge, dismiss, markRead, notifications, scheduleAppointmentReminders,
  scheduleReminder, snooze, tick, unreadCount, upcomingReminders,
} from '../src/lib/reminders.ts';
import { createAppointment } from '../src/lib/appointments.ts';
import { grantAccess, revokeGrant } from '../src/lib/consent.ts';
import { all, one, run } from '../src/db/index.ts';

const TZ = 'Asia/Kolkata';
const future = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('reminders and notifications', () => {
  beforeEach(resetDb);

  it('schedules one reminder per recipient and never duplicates it', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const appt = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: future(5 * 86_400_000), timezone: TZ,
    });
    const before = all('SELECT 1 FROM reminders WHERE subject_id = ?', appt).length;
    expect(before).toBe(1);

    // Re-running must be idempotent: the unique index absorbs repeats.
    scheduleAppointmentReminders(appt);
    scheduleAppointmentReminders(appt);
    expect(all('SELECT 1 FROM reminders WHERE subject_id = ?', appt).length).toBe(1);
  });

  it('does not backfill reminders for times already past', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    scheduleReminder({
      careProfileId: profile, subjectType: 'care_task', subjectId: 'tsk_whatever',
      recipientUserId: owner.id, dueAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(all('SELECT 1 FROM reminders').length).toBe(0);
  });

  it('generates a notification once the due time passes, and only once', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const appt = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: future(5 * 86_400_000), timezone: TZ,
    });
    expect(tick().generated).toBe(0); // not due yet

    run('UPDATE reminders SET due_at = ? WHERE subject_id = ?', future(-1000), appt);
    expect(tick().generated).toBe(1);
    expect(tick().generated).toBe(0); // the reminder is now 'generated', not 'scheduled'
    expect(all('SELECT 1 FROM notifications WHERE user_id = ?', owner.id).length).toBe(1);

    const reminder = one<{ status: string; generated_at: string }>(
      'SELECT status, generated_at FROM reminders WHERE subject_id = ?', appt,
    )!;
    expect(reminder.status).toBe('generated');
    expect(reminder.generated_at).toBeTruthy();
  });

  it('catches up on everything overdue after a restart', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    for (let i = 1; i <= 3; i++) {
      createAppointment({
        actorUserId: owner.id, careProfileId: profile, title: `Visit ${i}`,
        startsAt: future(i * 5 * 86_400_000), timezone: TZ,
      });
    }
    // Simulate the server having been off while all three fell due.
    run('UPDATE reminders SET due_at = ?', future(-60_000));
    const result = tick();
    expect(result.generated).toBe(3);
    expect(notifications(owner.id).length).toBe(3);
  });

  it('DROPS a reminder whose recipient lost access before it fired', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const grant = grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'appointments:view',
      purpose: 'driving', grantedByUserId: owner.id,
    });
    const appt = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: future(5 * 86_400_000), timezone: TZ, responsibleUserId: caregiver.id,
    });
    // Both the owner and the caregiver have a reminder.
    expect(all('SELECT 1 FROM reminders WHERE subject_id = ?', appt).length).toBe(2);

    revokeGrant(grant, owner.id);
    run('UPDATE reminders SET due_at = ? WHERE subject_id = ?', future(-1000), appt);
    const result = tick();
    // The owner's fires; the revoked caregiver's is cancelled, not delivered.
    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(notifications(caregiver.id).length).toBe(0);
    expect(notifications(owner.id).length).toBe(1);
  });

  it('drops a reminder for something that was cancelled', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const appt = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: future(5 * 86_400_000), timezone: TZ,
    });
    run('UPDATE reminders SET due_at = ? WHERE subject_id = ?', future(-1000), appt);
    run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", appt);
    const result = tick();
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('distinguishes read from acknowledged', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const appt = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: future(5 * 86_400_000), timezone: TZ,
    });
    run('UPDATE reminders SET due_at = ? WHERE subject_id = ?', future(-1000), appt);
    tick();
    const note = notifications(owner.id)[0]!;
    expect(unreadCount(owner.id)).toBe(1);

    markRead(owner.id, note.id);
    expect(unreadCount(owner.id)).toBe(0);
    expect(notifications(owner.id)[0]?.read_at).toBeTruthy();
    // Reading is not acknowledging.
    expect(notifications(owner.id)[0]?.acknowledged_at).toBeNull();

    acknowledge(owner.id, note.id);
    expect(notifications(owner.id)[0]?.acknowledged_at).toBeTruthy();
  });

  it('hides a snoozed notification until its time, and a dismissed one by default', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const appt = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: future(5 * 86_400_000), timezone: TZ,
    });
    run('UPDATE reminders SET due_at = ? WHERE subject_id = ?', future(-1000), appt);
    tick();
    const note = notifications(owner.id)[0]!;

    snooze(owner.id, note.id, 60);
    expect(notifications(owner.id).length).toBe(0);
    expect(unreadCount(owner.id)).toBe(0);

    run('UPDATE notifications SET snoozed_until = ? WHERE id = ?', future(-1000), note.id);
    expect(notifications(owner.id).length).toBe(1);

    dismiss(owner.id, note.id);
    expect(notifications(owner.id).length).toBe(0);
    expect(notifications(owner.id, { includeDismissed: true }).length).toBe(1);
  });

  it('a user cannot touch somebody else\'s notification', () => {
    const owner = makeUser();
    const other = makeUser();
    const profile = makeProfile(owner.id);
    const appt = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: future(5 * 86_400_000), timezone: TZ,
    });
    run('UPDATE reminders SET due_at = ? WHERE subject_id = ?', future(-1000), appt);
    tick();
    const note = notifications(owner.id)[0]!;

    // Every mutation is scoped by user_id, so these are no-ops rather than errors.
    markRead(other.id, note.id);
    dismiss(other.id, note.id);
    acknowledge(other.id, note.id);
    expect(notifications(owner.id)[0]?.read_at).toBeNull();
    expect(notifications(owner.id).length).toBe(1);
    expect(notifications(other.id).length).toBe(0);
  });

  it('lists only the signed-in user\'s scheduled reminders', () => {
    const owner = makeUser();
    const other = makeUser();
    const profile = makeProfile(owner.id);
    createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: future(5 * 86_400_000), timezone: TZ,
    });
    expect(upcomingReminders(owner.id).length).toBe(1);
    expect(upcomingReminders(other.id).length).toBe(0);
  });

  it('notification text stays administrative and quotes a dose instruction verbatim', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const { createSchedule } = await import('../src/lib/medications.ts');
    const { todayInZone } = await import('../src/lib/time.ts');
    const id = createSchedule({
      actorUserId: owner.id, careProfileId: profile, medicationName: 'Fictamol',
      doseInstruction: '1 tablet twice a day after food',
      instructionSource: 'clinician_written', timesOfDay: ['09:00'],
      startDate: todayInZone(TZ), timezone: TZ,
    });
    run("UPDATE reminders SET due_at = ? WHERE subject_type = 'medication_dose'", future(-1000));
    tick();
    const note = notifications(owner.id).find((n) => n.kind === 'medication_reminder');
    expect(note).toBeTruthy();
    // Quoted exactly, and it asks rather than asserts.
    expect(note!.body).toContain('"1 tablet twice a day after food"');
    expect(note!.body).toMatch(/confirm whether it was taken/i);
    expect(id).toBeTruthy();
  });
});
