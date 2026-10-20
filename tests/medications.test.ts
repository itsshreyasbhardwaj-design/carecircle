import { beforeEach, describe, expect, it } from 'vitest';
import { makeProfile, makeUser, resetDb } from './helpers.ts';
import {
  checkinTally, checkinsInWindow, createSchedule, discontinueSchedule, getSchedule,
  listSchedules, recordCheckin, unconfirmedCheckins, updateSchedule,
} from '../src/lib/medications.ts';
import { grantAccess } from '../src/lib/consent.ts';
import { AuthzError } from '../src/lib/authz.ts';
import { localToUtc, todayInZone } from '../src/lib/time.ts';
import { all, one, run } from '../src/db/index.ts';

const TZ = 'Asia/Kolkata';

function schedule(userId: string, profileId: string, over: Partial<{
  times: string[]; start: string; instruction: string;
}> = {}) {
  return createSchedule({
    actorUserId: userId, careProfileId: profileId,
    medicationName: 'Fictamol', strength: '500 mg', form: 'tablet',
    doseInstruction: over.instruction ?? '1 tablet twice a day after food',
    instructionSource: 'clinician_written',
    timesOfDay: over.times ?? ['09:00', '21:00'],
    startDate: over.start ?? todayInZone(TZ), timezone: TZ,
  });
}

describe('medication routines', () => {
  beforeEach(resetDb);

  it('records who confirmed the instruction, verbatim', () => {
    const owner = makeUser('Asha');
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile);
    const row = getSchedule(owner.id, id)!;
    expect(row.dose_instruction).toBe('1 tablet twice a day after food');
    expect(row.instruction_source).toBe('clinician_written');
    expect(row.confirmed_by_name).toBe('Asha');
    expect(row.confirmed_at).toBeTruthy();
  });

  it('refuses an empty instruction and an invalid time', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    expect(() => schedule(owner.id, profile, { instruction: '   ' }))
      .toThrow(/will not compose one/i);
    expect(() => schedule(owner.id, profile, { times: ['25:00'] })).toThrow(/not a valid time/i);
    expect(() => schedule(owner.id, profile, { times: [] })).toThrow(/at least one/i);
  });

  it('creates one dose slot per time per day, all unconfirmed', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile, { times: ['09:00', '21:00'] });
    const slots = all<{ status: string; scheduled_for: string }>(
      'SELECT status, scheduled_for FROM medication_checkins WHERE schedule_id = ?', id,
    );
    expect(slots.length).toBe(14); // 2 times x 7 days
    expect(slots.every((s) => s.status === 'not_confirmed')).toBe(true);
  });

  it('only a person can mark a dose taken, and it is attributed to them', () => {
    const owner = makeUser('Asha');
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile);
    const slot = localToUtc(todayInZone(TZ), '09:00', TZ);

    recordCheckin({ actorUserId: owner.id, scheduleId: id, scheduledFor: slot,
                    status: 'taken', note: 'with breakfast' });
    const row = one<{ status: string; reported_by_user_id: string; note: string }>(
      'SELECT status, reported_by_user_id, note FROM medication_checkins WHERE schedule_id = ? AND scheduled_for = ?',
      id, slot,
    )!;
    expect(row.status).toBe('taken');
    expect(row.reported_by_user_id).toBe(owner.id);
    expect(row.note).toBe('with breakfast');
  });

  it('the database itself refuses a check-in with no reporter', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile);
    const slot = localToUtc(todayInZone(TZ), '09:00', TZ);
    // The CHECK constraint is the backstop: no code path can claim "taken"
    // without naming the person who reported it.
    expect(() =>
      run(`UPDATE medication_checkins SET status = 'taken', reported_by_user_id = NULL
           WHERE schedule_id = ? AND scheduled_for = ?`, id, slot),
    ).toThrow();
  });

  it('a past unanswered slot is reported as unconfirmed, not as missed', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile, { start: todayInZone(TZ) });
    // Move one slot into the past without answering it.
    const slot = localToUtc(todayInZone(TZ), '09:00', TZ);
    run('UPDATE medication_checkins SET scheduled_for = ? WHERE schedule_id = ? AND scheduled_for = ?',
        new Date(Date.now() - 3_600_000).toISOString(), id, slot);

    const pending = unconfirmedCheckins(owner.id, 50);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((c) => c.status === 'not_confirmed')).toBe(true);

    const tally = checkinTally(owner.id, id, 30);
    expect(tally.tally.taken).toBe(0);
    // Explicitly not an adherence metric.
    expect(tally.note).toMatch(/not a clinical assessment/i);
  });

  it('a view-only caregiver can see but not report a check-in', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'medications:view',
      purpose: 'keeps an eye on the routine', grantedByUserId: owner.id,
    });
    expect(listSchedules(caregiver.id, {}).length).toBe(1);
    expect(
      checkinsInWindow(caregiver.id, '2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z').length,
    ).toBeGreaterThan(0);
    expect(() =>
      recordCheckin({
        actorUserId: caregiver.id, scheduleId: id,
        scheduledFor: localToUtc(todayInZone(TZ), '09:00', TZ), status: 'taken',
      }),
    ).toThrow(AuthzError);
  });

  it('hides routines from a stranger entirely', () => {
    const owner = makeUser();
    const stranger = makeUser();
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile);
    expect(listSchedules(stranger.id, {}).length).toBe(0);
    expect(() => getSchedule(stranger.id, id)).toThrow(AuthzError);
    expect(unconfirmedCheckins(stranger.id).length).toBe(0);
  });

  it('re-records who confirmed it when the instruction changes', () => {
    const owner = makeUser('Asha');
    const caregiver = makeUser('Priya');
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'medications:manage',
      purpose: 'manages the routine', grantedByUserId: owner.id,
    });
    updateSchedule({
      actorUserId: caregiver.id, id,
      doseInstruction: '1 tablet once a day after breakfast',
      instructionSource: 'caregiver_entered',
    });
    const row = getSchedule(owner.id, id)!;
    expect(row.dose_instruction).toBe('1 tablet once a day after breakfast');
    expect(row.confirmed_by_name).toBe('Priya');
    expect(row.instruction_source).toBe('caregiver_entered');
  });

  it('discontinuing stops future reminders and keeps past check-ins', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = schedule(owner.id, profile);
    const slot = localToUtc(todayInZone(TZ), '09:00', TZ);
    recordCheckin({ actorUserId: owner.id, scheduleId: id, scheduledFor: slot, status: 'taken' });

    discontinueSchedule(owner.id, id, 'Course finished');
    const row = getSchedule(owner.id, id)!;
    expect(row.status).toBe('discontinued');
    expect(row.discontinued_reason).toBe('Course finished');

    expect(all("SELECT 1 FROM reminders WHERE subject_id LIKE ? AND status = 'scheduled'",
               `${id}:%`).length).toBe(0);
    // The answered slot survives; unanswered future ones are cleared.
    expect(all('SELECT 1 FROM medication_checkins WHERE schedule_id = ? AND status = ?',
               id, 'taken').length).toBe(1);
    expect(all(`SELECT 1 FROM medication_checkins WHERE schedule_id = ?
                AND status = 'not_confirmed' AND scheduled_for > ?`,
               id, new Date().toISOString()).length).toBe(0);
    // It no longer appears in the active list.
    expect(listSchedules(owner.id, {}).length).toBe(0);
    expect(listSchedules(owner.id, { includeDiscontinued: true }).length).toBe(1);
  });

  it('refuses to attach a prescription the actor cannot read', async () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const { uploadDocument } = await import('../src/lib/documents.ts');
    const doc = await uploadDocument({
      actorUserId: owner.id, careProfileId: profile, filename: 'rx.txt',
      declaredMime: 'text/plain', bytes: Buffer.from('Rx tablet prescription\n'),
      title: 'Rx', category: 'prescription', sensitivity: 'restricted',
    });
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'medications:manage',
      purpose: 'routine help', grantedByUserId: owner.id,
    });
    expect(() =>
      createSchedule({
        actorUserId: caregiver.id, careProfileId: profile, medicationName: 'Fictamol',
        doseInstruction: '1 tablet daily', instructionSource: 'caregiver_entered',
        timesOfDay: ['09:00'], startDate: todayInZone(TZ), timezone: TZ,
        prescriptionDocumentId: doc.documentId,
      }),
    ).toThrow(AuthzError);
  });
});
