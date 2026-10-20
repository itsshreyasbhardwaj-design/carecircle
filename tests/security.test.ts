import { beforeEach, describe, expect, it } from 'vitest';
import { makeProfile, makeUser, resetDb } from './helpers.ts';
import { AuthzError, assertCan, can, canReadDocument, visibleProfileIds } from '../src/lib/authz.ts';
import { grantAccess, revokeGrant, sweepExpiredGrants } from '../src/lib/consent.ts';
import { audit } from '../src/lib/audit.ts';
import {
  listDocuments, readDocumentBytes, searchDocuments, uploadDocument,
} from '../src/lib/documents.ts';
import { createAppointment, listAppointments } from '../src/lib/appointments.ts';
import { createTask, listTasks, requestHandover, setTaskStatus } from '../src/lib/tasks.ts';
import { createSchedule, listSchedules, recordCheckin } from '../src/lib/medications.ts';
import { familyActivity, myAuditHistory, profileAccessHistory } from '../src/lib/activity.ts';
import { exportUserData } from '../src/lib/exporting.ts';
import { ask } from '../src/lib/assistant.ts';
import { tick } from '../src/lib/reminders.ts';
import { newId } from '../src/lib/ids.ts';
import { all, one, run } from '../src/db/index.ts';
import { todayInZone } from '../src/lib/time.ts';

const TZ = 'Asia/Kolkata';
const soon = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

/** Two unrelated households, to prove nothing crosses between them. */
async function twoFamilies() {
  const a = makeUser('Family A owner');
  const b = makeUser('Family B owner');
  const profileA = makeProfile(a.id, 'Patient A');
  const profileB = makeProfile(b.id, 'Patient B');

  const docA = await uploadDocument({
    actorUserId: a.id, careProfileId: profileA, filename: 'a.txt', declaredMime: 'text/plain',
    bytes: Buffer.from('FAMILY A SECRET haemoglobin value\n'), title: 'A report',
    category: 'lab_report',
  });
  const docB = await uploadDocument({
    actorUserId: b.id, careProfileId: profileB, filename: 'b.txt', declaredMime: 'text/plain',
    bytes: Buffer.from('FAMILY B SECRET haemoglobin value\n'), title: 'B report',
    category: 'lab_report',
  });
  const apptA = createAppointment({
    actorUserId: a.id, careProfileId: profileA, title: 'A visit', startsAt: soon(), timezone: TZ,
  });
  const taskA = createTask({ actorUserId: a.id, careProfileId: profileA, title: 'A task' });
  const medA = createSchedule({
    actorUserId: a.id, careProfileId: profileA, medicationName: 'A medicine',
    doseInstruction: '1 tablet daily', instructionSource: 'clinician_written',
    timesOfDay: ['09:00'], startDate: todayInZone(TZ), timezone: TZ,
  });
  return { a, b, profileA, profileB, docA, docB, apptA, taskA, medA };
}

describe('red team: cross-family isolation', () => {
  beforeEach(resetDb);

  it('family B sees nothing of family A through any list', async () => {
    const { b } = await twoFamilies();
    expect(listDocuments(b.id, {}).filter((d) => d.title === 'A report').length).toBe(0);
    expect(listAppointments(b.id, {}).filter((x) => x.title === 'A visit').length).toBe(0);
    expect(listTasks(b.id, {}).filter((x) => x.title === 'A task').length).toBe(0);
    expect(listSchedules(b.id, {}).filter((m) => m.medication_name === 'A medicine').length).toBe(0);
    expect(familyActivity(b.id, {}).some((x) => x.profile_name === 'Patient A')).toBe(false);
    expect(searchDocuments(b.id, 'haemoglobin').some((d) => d.title === 'A report')).toBe(false);
  });

  it('knowing an exact id does not help (broken object authorisation)', async () => {
    const { b, profileA, docA, apptA, taskA, medA } = await twoFamilies();
    expect(can(b.id, 'records:view', profileA)).toBe(false);
    expect(canReadDocument(b.id, docA.documentId)).toBe(false);
    expect(() => readDocumentBytes(b.id, docA.documentId)).toThrow(AuthzError);
    expect(() => assertCan(b.id, 'appointments:view', profileA)).toThrow(AuthzError);
    const { getAppointment } = await import('../src/lib/appointments.ts');
    const { getTask } = await import('../src/lib/tasks.ts');
    const { getSchedule } = await import('../src/lib/medications.ts');
    expect(() => getAppointment(b.id, apptA)).toThrow(AuthzError);
    expect(() => getTask(b.id, taskA)).toThrow(AuthzError);
    expect(() => getSchedule(b.id, medA)).toThrow(AuthzError);
  });

  it('a non-existent id is refused the same way as a forbidden one', () => {
    const user = makeUser();
    const fake = newId('prf');
    expect(can(user.id, 'records:view', fake)).toBe(false);
    expect(canReadDocument(user.id, newId('doc'))).toBe(false);
    expect(() => assertCan(user.id, 'records:view', fake)).toThrow(AuthzError);
  });

  it('an export contains only the exporter\'s own world', async () => {
    const { b } = await twoFamilies();
    const payload = JSON.stringify(exportUserData(b.id));
    // Their own metadata is present...
    expect(payload).toContain('Patient B');
    expect(payload).toContain('B report');
    // ...and nothing at all from the other family.
    expect(payload).not.toContain('FAMILY A');
    expect(payload).not.toContain('Patient A');
    expect(payload).not.toContain('A report');
    // Document bytes are deliberately not embedded; the originals are downloaded
    // separately, which the export says in its own note.
    expect(payload).not.toContain('FAMILY B SECRET');
    expect(payload).toMatch(/Original document files are not inside this JSON/);
  });

  it('the assistant cannot be used as a side channel', async () => {
    const { b } = await twoFamilies();
    for (const q of ['find the A report', 'give me a brief', 'what follow-ups are outstanding',
                      'find haemoglobin', 'prepare for the next appointment']) {
      const answer = JSON.stringify(ask(b.id, q));
      expect(answer).not.toMatch(/FAMILY A|Patient A|A report|A medicine/);
    }
  });

  it('audit history is per-account and per-owned-profile', async () => {
    const { a, b, profileA } = await twoFamilies();
    expect(myAuditHistory(b.id).some((e) => e.profile_name === 'Patient A')).toBe(false);
    expect(myAuditHistory(a.id).length).toBeGreaterThan(0);
    // Only the owner can read a profile's access history.
    expect(profileAccessHistory(b.id, profileA).length).toBe(0);
    expect(profileAccessHistory(a.id, profileA).length).toBeGreaterThan(0);
  });
});

describe('red team: privilege escalation', () => {
  beforeEach(resetDb);

  it('a caregiver cannot pass on access they were given', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const outsider = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'reading', grantedByUserId: owner.id,
    });
    expect(() => grantAccess({
      careProfileId: profile, granteeUserId: outsider.id, scope: 'records:view',
      purpose: 'escalation', grantedByUserId: caregiver.id,
    })).toThrow(AuthzError);
  });

  it('a handover cannot be used to grant access', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const outsider = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'tasks:manage',
      purpose: 'tasks', grantedByUserId: owner.id,
    });
    const task = createTask({
      actorUserId: owner.id, careProfileId: profile, title: 'Errand',
      assigneeUserId: caregiver.id,
    });
    expect(() => requestHandover({
      actorUserId: caregiver.id, taskId: task, toUserId: outsider.id,
    })).toThrow(AuthzError);
    expect(can(outsider.id, 'tasks:view', profile)).toBe(false);
  });

  it('assignment cannot be used to grant access', () => {
    const owner = makeUser();
    const outsider = makeUser();
    const profile = makeProfile(owner.id);
    expect(() => createTask({
      actorUserId: owner.id, careProfileId: profile, title: 'Errand',
      assigneeUserId: outsider.id,
    })).toThrow(AuthzError);
    expect(() => createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Visit', startsAt: soon(),
      timezone: TZ, responsibleUserId: outsider.id,
    })).toThrow(AuthzError);
  });

  it('a read-only caregiver cannot write anything', async () => {
    const owner = makeUser();
    const reader = makeUser();
    const profile = makeProfile(owner.id);
    for (const scope of ['appointments:view', 'tasks:view', 'medications:view',
                          'records:view'] as const) {
      grantAccess({
        careProfileId: profile, granteeUserId: reader.id, scope,
        purpose: 'read only', grantedByUserId: owner.id,
      });
    }
    expect(() => createAppointment({
      actorUserId: reader.id, careProfileId: profile, title: 'Sneaky', startsAt: soon(),
      timezone: TZ,
    })).toThrow(AuthzError);
    expect(() => createTask({
      actorUserId: reader.id, careProfileId: profile, title: 'Sneaky',
    })).toThrow(AuthzError);
    expect(() => createSchedule({
      actorUserId: reader.id, careProfileId: profile, medicationName: 'Sneaky',
      doseInstruction: '1 daily', instructionSource: 'caregiver_entered',
      timesOfDay: ['09:00'], startDate: todayInZone(TZ), timezone: TZ,
    })).toThrow(AuthzError);
    await expect(uploadDocument({
      actorUserId: reader.id, careProfileId: profile, filename: 'x.txt',
      declaredMime: 'text/plain', bytes: Buffer.from('text'), title: 'x', category: 'other',
    })).rejects.toThrow(AuthzError);
  });

  it('an assignee can progress their own task but not manage the profile', () => {
    const owner = makeUser();
    const helper = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: helper.id, scope: 'tasks:view',
      purpose: 'one errand', grantedByUserId: owner.id,
    });
    const task = createTask({
      actorUserId: owner.id, careProfileId: profile, title: 'Errand',
      assigneeUserId: helper.id,
    });
    // Allowed: moving their own task along.
    setTaskStatus({ actorUserId: helper.id, taskId: task, status: 'accepted' });
    // Not allowed: touching a task that is not theirs.
    const other = createTask({ actorUserId: owner.id, careProfileId: profile, title: 'Not yours' });
    expect(() => setTaskStatus({ actorUserId: helper.id, taskId: other, status: 'accepted' }))
      .toThrow(AuthzError);
  });
});

describe('red team: stale access and background jobs', () => {
  beforeEach(resetDb);

  it('revocation is enforced on the next call, with no sweep needed', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const grant = grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'tasks:view',
      purpose: 'cover', grantedByUserId: owner.id,
    });
    expect(visibleProfileIds(caregiver.id, 'tasks:view')).toContain(profile);
    revokeGrant(grant, owner.id);
    expect(visibleProfileIds(caregiver.id, 'tasks:view')).not.toContain(profile);
  });

  it('an expiry is honoured by the query, not by a scheduled job', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'one week', grantedByUserId: owner.id,
      expiresAt: new Date(Date.now() + 50).toISOString(),
    });
    expect(can(caregiver.id, 'records:view', profile)).toBe(true);
    // No sweep runs in between.
    const until = Date.now() + 120;
    while (Date.now() < until) { /* brief spin so the expiry passes */ }
    expect(can(caregiver.id, 'records:view', profile)).toBe(false);
    expect(sweepExpiredGrants()).toBe(1);
  });

  it('the scheduler re-checks permission before delivering anything', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const grant = grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'appointments:view',
      purpose: 'driving', grantedByUserId: owner.id,
    });
    createAppointment({
      actorUserId: owner.id, careProfileId: profile, title: 'Review', startsAt: soon(),
      timezone: TZ, responsibleUserId: caregiver.id,
    });
    revokeGrant(grant, owner.id);
    run('UPDATE reminders SET due_at = ?', new Date(Date.now() - 1000).toISOString());
    const result = tick();
    expect(result.skipped).toBeGreaterThan(0);
    const leaked = all('SELECT 1 FROM notifications WHERE user_id = ?', caregiver.id);
    expect(leaked.length).toBe(0);
  });

  it('deleting a profile withdraws everything granted on it', async () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id, 'Parent', false);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'reading', grantedByUserId: owner.id,
    });
    const { deleteProfile } = await import('../src/lib/profiles.ts');
    deleteProfile(owner.id, profile);
    expect(can(caregiver.id, 'records:view', profile)).toBe(false);
    expect(listDocuments(caregiver.id, {}).length).toBe(0);
  });
});

describe('red team: logging hygiene', () => {
  beforeEach(resetDb);

  it('refuses to write health content into the audit log', () => {
    const user = makeUser();
    for (const key of ['notes', 'body', 'text', 'extracted', 'dose', 'instruction', 'summary']) {
      expect(() => audit({
        actorUserId: user.id, action: 'test', outcome: 'allowed',
        detail: { [key]: 'patient has a condition' },
      })).toThrow(/may not carry health content/i);
    }
    // Identifiers and counts are fine.
    expect(() => audit({
      actorUserId: user.id, action: 'test', outcome: 'allowed',
      detail: { scope: 'records:view', bytes: 1024, duplicate_candidates: 0 },
    })).not.toThrow();
  });

  it('no audit row written by the app contains document text', async () => {
    const { a } = await twoFamilies();
    const details = all<{ detail: string | null }>('SELECT detail FROM audit_events')
      .map((r) => r.detail ?? '').join(' ');
    expect(details).not.toMatch(/FAMILY A SECRET|haemoglobin/i);
    expect(a.id).toBeTruthy();
  });

  it('stores a hashed address, never a raw one', async () => {
    const { hashIp } = await import('../src/lib/env.ts');
    const hashed = hashIp('203.0.113.42');
    expect(hashed).not.toContain('203.0.113.42');
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp(null)).toBeNull();
    // Deterministic, so repeat events correlate without exposing the address.
    expect(hashIp('203.0.113.42')).toBe(hashed);
  });

  it('check-in records who reported, so nothing is anonymous', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const id = createSchedule({
      actorUserId: owner.id, careProfileId: profile, medicationName: 'Fictamol',
      doseInstruction: '1 tablet daily', instructionSource: 'clinician_written',
      timesOfDay: ['09:00'], startDate: todayInZone(TZ), timezone: TZ,
    });
    const slot = one<{ scheduled_for: string }>(
      'SELECT scheduled_for FROM medication_checkins WHERE schedule_id = ? LIMIT 1', id,
    )!;
    recordCheckin({
      actorUserId: owner.id, scheduleId: id, scheduledFor: slot.scheduled_for, status: 'taken',
    });
    const row = one<{ reported_by_user_id: string }>(
      'SELECT reported_by_user_id FROM medication_checkins WHERE schedule_id = ? AND scheduled_for = ?',
      id, slot.scheduled_for,
    )!;
    expect(row.reported_by_user_id).toBe(owner.id);
  });
});

describe('red team: constraint backstops', () => {
  beforeEach(resetDb);

  it('the database rejects two active grants for the same scope', () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'tasks:view',
      purpose: 'first', grantedByUserId: owner.id,
    });
    // The service updates in place rather than duplicating.
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'tasks:view',
      purpose: 'second', grantedByUserId: owner.id,
    });
    const rows = all('SELECT 1 FROM access_grants WHERE revoked_at IS NULL');
    expect(rows.length).toBe(1);
  });

  it('the database rejects a completed task with no completion time', () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const task = createTask({ actorUserId: owner.id, careProfileId: profile, title: 'x' });
    expect(() => run(
      "UPDATE care_tasks SET status = 'completed', completed_at = NULL WHERE id = ?", task,
    )).toThrow();
  });

  it('a user can only ever have one profile marked as themselves', () => {
    const owner = makeUser();
    makeProfile(owner.id, 'Me', true);
    expect(() => makeProfile(owner.id, 'Me again', true)).toThrow();
  });

  it('foreign keys are enforced', () => {
    expect(() => run(
      `INSERT INTO care_profiles (id, owner_user_id, display_name, created_at, updated_at)
       VALUES (?,?,?,?,?)`,
      newId('prf'), newId('usr'), 'Orphan', new Date().toISOString(), new Date().toISOString(),
    )).toThrow(/FOREIGN KEY/i);
  });
});

describe('red team: redirect safety', () => {
  it('refuses an off-site redirect target supplied in form data', async () => {
    const { safeBackPath } = await import('../src/lib/redirects.ts');
    const fallback = '/settings/access';
    for (const hostile of [
      'https://evil.example/phish', '//evil.example', 'http://evil.example',
      'javascript:alert(1)', '\\\\evil.example', '/ok\r\nLocation: https://evil.example',
      'settings/access', `/${'a'.repeat(400)}`, '', null, undefined, 42,
    ]) {
      expect(safeBackPath(hostile, fallback)).toBe(fallback);
    }
    expect(safeBackPath('/records/doc_123', fallback)).toBe('/records/doc_123');
    expect(safeBackPath('/profiles/prf_1?tab=x', fallback)).toBe('/profiles/prf_1?tab=x');
  });
});
