import { beforeEach, describe, expect, it } from 'vitest';
import { makeProfile, makeUser, resetDb } from './helpers.ts';
import {
  addPrepItem, createAppointment, getAppointment, listAppointments, prepItems,
  rescheduleAppointment, setAppointmentStatus, assignResponsible, upcomingAppointments,
} from '../src/lib/appointments.ts';
import {
  assignTask, cancelHandover, commentOnTask, createTask, getTask, handoverHistory, listTasks,
  pendingHandoversFor, requestHandover, respondToHandover, setTaskStatus, taskHistory,
} from '../src/lib/tasks.ts';
import { grantAccess, revokeGrant } from '../src/lib/consent.ts';
import { AuthzError, can } from '../src/lib/authz.ts';
import { tick } from '../src/lib/reminders.ts';
import { localToUtc } from '../src/lib/time.ts';
import { all, one, run } from '../src/db/index.ts';

const TZ = 'Asia/Kolkata';
const soon = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

describe('appointments', () => {
  beforeEach(resetDb);

  it('creates, reads and lists an appointment for the owner', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Cardiology review',
      startsAt: soon(), timezone: TZ, providerName: 'Dr. R. Nair',
    });
    expect(getAppointment(owner.id, id)?.title).toBe('Cardiology review');
    expect(listAppointments(owner.id, {}).length).toBe(1);
    expect(upcomingAppointments(owner.id, 14).length).toBe(1);
  });

  it('hides appointments from a stranger and from a records-only caregiver', () => {
    const owner = makeUser();
    const stranger = makeUser();
    const reader = makeUser();
    const profile = makeProfile(owner.id);
    const id = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Private visit',
      startsAt: soon(), timezone: TZ,
    });
    grantAccess({
      careProfileId: profile, granteeUserId: reader.id, scope: 'records:view',
      purpose: 'documents only', grantedByUserId: owner.id,
    });
    expect(listAppointments(stranger.id, {}).length).toBe(0);
    expect(listAppointments(reader.id, {}).length).toBe(0);
    expect(() => getAppointment(stranger.id, id)).toThrow(AuthzError);
  });

  it('refuses to assign someone who cannot see the profile', () => {
    const owner = makeUser();
    const outsider = makeUser();
    const profile = makeProfile(owner.id);
    expect(() =>
      createAppointment({
        actorUserId: owner.id, careProfileId: profile, title: 'Visit',
        startsAt: soon(), timezone: TZ, responsibleUserId: outsider.id,
      }),
    ).toThrow(AuthzError);
  });

  it('assigns someone once they hold the right scope', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const id = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Visit',
      startsAt: soon(), timezone: TZ,
    });
    expect(() => assignResponsible(owner.id, id, caregiver.id)).toThrow(AuthzError);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'appointments:view',
      purpose: 'driving', grantedByUserId: owner.id,
    });
    assignResponsible(owner.id, id, caregiver.id);
    expect(getAppointment(owner.id, id)?.responsible_user_id).toBe(caregiver.id);
  });

  it('rescheduling keeps the original and copies the preparation list', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: soon(), timezone: TZ,
    });
    addPrepItem({ actorUserId: owner.id, appointmentId: id, kind: 'question',
                  text: 'Ask about the evening dose' });

    const replacement = rescheduleAppointment({
      actorUserId: owner.id, id, startsAt: localToUtc('2026-12-01', '10:00', TZ),
      timezone: TZ, reason: 'Clinic moved the slot',
    });
    expect(getAppointment(owner.id, id)?.status).toBe('rescheduled');
    expect(getAppointment(owner.id, replacement)?.status).toBe('scheduled');
    expect(prepItems(owner.id, replacement).length).toBe(1);
    expect(prepItems(owner.id, replacement)[0]?.done).toBe(0); // carried over unticked
  });

  it('marks a preparation item as clinic-provided only when told to', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: soon(), timezone: TZ,
    });
    addPrepItem({ actorUserId: owner.id, appointmentId: id, kind: 'question', text: 'Mine' });
    addPrepItem({ actorUserId: owner.id, appointmentId: id, kind: 'instruction',
                  text: 'Bring the old prescription', source: 'clinician_provided' });
    const items = prepItems(owner.id, id);
    expect(items.find((i) => i.text === 'Mine')?.source).toBe('user');
    expect(items.find((i) => i.text.startsWith('Bring'))?.source).toBe('clinician_provided');
  });

  it('cancels scheduled reminders when an appointment is cancelled', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review',
      startsAt: soon(), timezone: TZ,
    });
    expect(all('SELECT 1 FROM reminders WHERE subject_id = ? AND status = ?', id, 'scheduled').length)
      .toBeGreaterThan(0);
    setAppointmentStatus(owner.id, id, 'cancelled');
    expect(all('SELECT 1 FROM reminders WHERE subject_id = ? AND status = ?', id, 'scheduled').length)
      .toBe(0);
  });
});

describe('care tasks', () => {
  beforeEach(resetDb);

  function pair() {
    const owner = makeUser('Owner');
    const helper = makeUser('Helper');
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: helper.id, scope: 'tasks:manage',
      purpose: 'helps with errands', grantedByUserId: owner.id,
    });
    return { owner, helper, profile };
  }

  it('creates a task with a full history', () => {
    const { owner, helper, profile } = pair();
    const id = createTask({
      actorUserId: owner.id, careProfileId: profile, title: 'Collect report',
      assigneeUserId: helper.id, dueAt: soon(),
    });
    const history = taskHistory(owner.id, id);
    expect(history.map((h) => h.kind)).toEqual(['created', 'assigned']);
    expect(getTask(owner.id, id)?.status).toBe('pending');
  });

  it('walks the whole status lifecycle and refuses an illegal jump', () => {
    const { owner, helper, profile } = pair();
    const id = createTask({
      actorUserId: owner.id, careProfileId: profile, title: 'Collect report',
      assigneeUserId: helper.id,
    });
    setTaskStatus({ actorUserId: helper.id, taskId: id, status: 'accepted' });
    setTaskStatus({ actorUserId: helper.id, taskId: id, status: 'in_progress' });
    setTaskStatus({ actorUserId: helper.id, taskId: id, status: 'completed', note: 'done' });

    const done = getTask(owner.id, id)!;
    expect(done.status).toBe('completed');
    expect(done.completed_at).not.toBeNull();
    expect(done.completed_by_name).toBe('Helper');
    // A completed task is final.
    expect(() => setTaskStatus({ actorUserId: helper.id, taskId: id, status: 'pending' }))
      .toThrow(/cannot become/i);
  });

  it('never completes a task as a side effect of a reminder firing', () => {
    const { owner, profile } = pair();
    const id = createTask({
      actorUserId: owner.id, careProfileId: profile, title: 'Book follow-up',
      dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    // A reminder was scheduled for this task.
    expect(all('SELECT 1 FROM reminders WHERE subject_id = ?', id).length).toBeGreaterThan(0);

    // Pull it into the past and run the scheduler, so a notification is generated.
    run('UPDATE reminders SET due_at = ? WHERE subject_id = ?',
        new Date(Date.now() - 1000).toISOString(), id);
    const result = tick();
    expect(result.generated).toBeGreaterThan(0);
    expect(all('SELECT 1 FROM notifications').length).toBeGreaterThan(0);

    // The task itself is untouched: a delivered reminder is not progress.
    expect(getTask(owner.id, id)?.status).toBe('pending');
    expect(getTask(owner.id, id)?.completed_at).toBeNull();
  });

  it('a stranger cannot read, update or comment on a task', () => {
    const { owner, profile } = pair();
    const stranger = makeUser();
    const id = createTask({ actorUserId: owner.id, careProfileId: profile, title: 'Private' });
    expect(() => getTask(stranger.id, id)).toThrow(AuthzError);
    expect(() => setTaskStatus({ actorUserId: stranger.id, taskId: id, status: 'accepted' }))
      .toThrow(AuthzError);
    expect(() => commentOnTask(stranger.id, id, 'hello')).toThrow(AuthzError);
    expect(listTasks(stranger.id, {}).length).toBe(0);
  });

  it('refuses to assign someone without tasks access', () => {
    const { owner, profile } = pair();
    const outsider = makeUser();
    const id = createTask({ actorUserId: owner.id, careProfileId: profile, title: 'Errand' });
    expect(() => assignTask(owner.id, id, outsider.id)).toThrow(AuthzError);
  });
});

describe('caregiver handovers', () => {
  beforeEach(resetDb);

  function household() {
    const owner = makeUser('Asha');
    const priya = makeUser('Priya');
    const arun = makeUser('Arun');
    const outsider = makeUser('Outsider');
    const profile = makeProfile(owner.id);
    for (const u of [priya, arun]) {
      grantAccess({
        careProfileId: profile, granteeUserId: u.id, scope: 'tasks:manage',
        purpose: 'family caregiver', grantedByUserId: owner.id,
      });
    }
    const task = createTask({
      actorUserId: owner.id, careProfileId: profile, title: 'Take Asha to the clinic',
      assigneeUserId: priya.id, dueAt: soon(),
    });
    return { owner, priya, arun, outsider, profile, task };
  }

  it('transfers responsibility once the other person accepts', () => {
    const { priya, arun, task, owner } = household();
    const handover = requestHandover({
      actorUserId: priya.id, taskId: task, toUserId: arun.id, reason: 'Work trip',
    });
    // Still Priya's until Arun agrees.
    expect(getTask(owner.id, task)?.assignee_user_id).toBe(priya.id);
    expect(pendingHandoversFor(arun.id).length).toBe(1);

    respondToHandover({ actorUserId: arun.id, handoverId: handover, accept: true });
    expect(getTask(owner.id, task)?.assignee_user_id).toBe(arun.id);
    expect(taskHistory(owner.id, task).some((h) => h.kind === 'handover_accepted')).toBe(true);
  });

  it('a declined handover leaves the task where it was', () => {
    const { priya, arun, task, owner } = household();
    const handover = requestHandover({ actorUserId: priya.id, taskId: task, toUserId: arun.id });
    respondToHandover({ actorUserId: arun.id, handoverId: handover, accept: false });
    expect(getTask(owner.id, task)?.assignee_user_id).toBe(priya.id);
    expect(handoverHistory(owner.id, task)[0]?.status).toBe('declined');
  });

  it('REFUSES a handover to someone who cannot see the profile', () => {
    const { priya, outsider, task } = household();
    expect(() =>
      requestHandover({ actorUserId: priya.id, taskId: task, toUserId: outsider.id }),
    ).toThrow(AuthzError);
    expect(pendingHandoversFor(outsider.id).length).toBe(0);
  });

  it('a handover grants no new access', () => {
    const { priya, arun, task, owner, profile } = household();
    const handover = requestHandover({ actorUserId: priya.id, taskId: task, toUserId: arun.id });
    respondToHandover({ actorUserId: arun.id, handoverId: handover, accept: true });
    // Arun now owns the task but still cannot read records or medications.
    expect(can(arun.id, 'tasks:manage', profile)).toBe(true);
    expect(can(arun.id, 'records:view', profile)).toBe(false);
    expect(can(arun.id, 'medications:view', profile)).toBe(false);
    expect(owner.id).toBeTruthy();
  });

  it('re-checks access at acceptance time, not only at request time', () => {
    const { owner, priya, arun, task, profile } = household();
    const handover = requestHandover({ actorUserId: priya.id, taskId: task, toUserId: arun.id });
    // The owner withdraws Arun's access while the request is open.
    const grant = one<{ id: string }>(
      `SELECT id FROM access_grants WHERE grantee_user_id = ? AND care_profile_id = ?
       AND revoked_at IS NULL`, arun.id, profile,
    )!;
    revokeGrant(grant.id, owner.id);
    expect(() => respondToHandover({ actorUserId: arun.id, handoverId: handover, accept: true }))
      .toThrow(AuthzError);
    expect(getTask(owner.id, task)?.assignee_user_id).toBe(priya.id);
  });

  it('only the person asked can answer the request', () => {
    const { priya, arun, task, owner } = household();
    const handover = requestHandover({ actorUserId: priya.id, taskId: task, toUserId: arun.id });
    expect(() => respondToHandover({ actorUserId: owner.id, handoverId: handover, accept: true }))
      .toThrow(AuthzError);
  });

  it('only one handover can be pending at a time, and it can be cancelled', () => {
    const { priya, arun, task, owner } = household();
    requestHandover({ actorUserId: priya.id, taskId: task, toUserId: arun.id });
    const second = requestHandover({ actorUserId: priya.id, taskId: task, toUserId: owner.id });
    const pending = handoverHistory(owner.id, task).filter((h) => h.status === 'pending');
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(second);

    cancelHandover(priya.id, second);
    expect(handoverHistory(owner.id, task).filter((h) => h.status === 'pending').length).toBe(0);
  });

  it('refuses a handover on a finished task', () => {
    const { priya, arun, task } = household();
    setTaskStatus({ actorUserId: priya.id, taskId: task, status: 'accepted' });
    setTaskStatus({ actorUserId: priya.id, taskId: task, status: 'completed' });
    expect(() => requestHandover({ actorUserId: priya.id, taskId: task, toUserId: arun.id }))
      .toThrow(/finished/i);
  });
});
