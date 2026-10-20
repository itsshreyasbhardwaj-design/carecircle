/**
 * Reproducible demo data.
 *
 * Every person, document, date and value below is invented. The script creates
 * its own dedicated demo accounts and marks every row it writes with is_demo = 1,
 * so fictional health records can never end up attached to a real account. It
 * refuses to modify any account it did not create.
 */
import { DatabaseSync } from 'node:sqlite';
import { configure, db, one, run } from '../src/db/index.ts';
import { migrate } from '../src/db/migrate.ts';
import { DB_PATH, DOCS_DIR, ensureDirs } from '../src/lib/env.ts';
import { registerUser, findUserByEmail, setOnboardingStep } from '../src/lib/accounts.ts';
import { createProfile } from '../src/lib/profiles.ts';
import { createCircle, listProfileInCircle, createInvitation, acceptInvitation, setAvailability } from '../src/lib/circles.ts';
import { grantAccess } from '../src/lib/consent.ts';
import { uploadDocument, confirmDocumentMetadata } from '../src/lib/documents.ts';
import { createAppointment, addPrepItem, linkDocument } from '../src/lib/appointments.ts';
import { createTask, setTaskStatus, requestHandover } from '../src/lib/tasks.ts';
import { createSchedule, recordCheckin } from '../src/lib/medications.ts';
import { tick } from '../src/lib/reminders.ts';
import { localToUtc, todayInZone } from '../src/lib/time.ts';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const TZ = 'Asia/Kolkata';
const PASSWORD = 'demo-carecircle-2026';

const PEOPLE = {
  asha:  { email: 'asha.demo@carecircle.test',  name: 'Asha Verma (demo)' },
  priya: { email: 'priya.demo@carecircle.test', name: 'Priya Verma (demo)' },
  arun:  { email: 'arun.demo@carecircle.test',  name: 'Arun Verma (demo)' },
};

ensureDirs();
const boot = configure(new DatabaseSync(DB_PATH));
migrate(boot);
boot.close();

const reset = process.argv.includes('--reset');

if (reset) {
  for (const p of Object.values(PEOPLE)) {
    const user = findUserByEmail(p.email);
    if (!user) continue;
    const paths = (db().prepare(
      `SELECT v.storage_path AS p FROM document_versions v
       JOIN medical_documents d ON d.id = v.document_id
       JOIN care_profiles cp ON cp.id = d.care_profile_id
       WHERE cp.owner_user_id = ?`).all(user.id) as { p: string }[]);
    for (const row of paths) rmSync(join(DOCS_DIR, row.p), { force: true });
    run('DELETE FROM users WHERE id = ?', user.id);
  }
  run("DELETE FROM care_circles WHERE is_demo = 1");
  console.log('removed existing demo accounts');
}

// Refuse to touch an account that was not created by this script.
for (const p of Object.values(PEOPLE)) {
  const existing = findUserByEmail(p.email);
  if (existing) {
    const isDemo = one<{ n: number }>(
      'SELECT count(*) n FROM care_profiles WHERE owner_user_id = ? AND is_demo = 1', existing.id,
    );
    if (!isDemo?.n) {
      console.error(
        `Refusing to continue: ${p.email} exists but was not created by the demo seed.\n` +
        `Run with --reset only if you are sure, or change the demo email addresses.`,
      );
      process.exit(1);
    }
    console.log('demo data already present — use `npm run reset:demo` to rebuild it');
    process.exit(0);
  }
}

function account(key: keyof typeof PEOPLE): string {
  const spec = PEOPLE[key];
  const result = registerUser({ email: spec.email, password: PASSWORD, fullName: spec.name, timezone: TZ });
  if (!result.ok) throw new Error(`${spec.email}: ${result.error}`);
  setOnboardingStep(result.user.id, 'done', true);
  return result.user.id;
}

const asha = account('asha');
const priya = account('priya');
const arun = account('arun');

// Asha manages her own care; her children are authorised caregivers.
const ashaProfile = createProfile({
  ownerUserId: asha, displayName: 'Asha Verma (demo)', relationship: 'self', isSelf: true,
  dateOfBirth: '1961-07-14', bloodGroup: 'B+', isDemo: true,
  notes: 'FICTIONAL demonstration profile. Not a real person.',
});
run('UPDATE care_profiles SET is_demo = 1 WHERE owner_user_id IN (?,?,?)', asha, priya, arun);

const circle = createCircle(asha, "Asha's care (demo)", true);
listProfileInCircle(asha, circle, ashaProfile);

// Both children join through a real invitation, so the demo exercises that path.
for (const [userId, email] of [[priya, PEOPLE.priya.email], [arun, PEOPLE.arun.email]] as const) {
  const invite = createInvitation({
    actorUserId: asha, circleId: circle, role: 'member', invitedEmail: email,
    message: 'Joining you to help coordinate my appointments.',
  });
  const accepted = acceptInvitation(invite.token, userId);
  if (!accepted.ok) throw new Error(accepted.error);
}

// Priya coordinates closely; Arun helps with tasks only. Note what Arun does NOT get.
for (const scope of ['appointments:manage', 'records:view', 'tasks:manage',
                      'medications:view', 'activity:view'] as const) {
  grantAccess({
    careProfileId: ashaProfile, granteeUserId: priya, scope,
    purpose: 'Daughter, coordinates my care day to day', grantedByUserId: asha,
  });
}
for (const scope of ['tasks:manage', 'appointments:view'] as const) {
  grantAccess({
    careProfileId: ashaProfile, granteeUserId: arun, scope,
    purpose: 'Son, helps with errands and transport', grantedByUserId: asha,
  });
}

const today = todayInZone(TZ);
const inDays = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---- fictional documents -----------------------------------------------------
const PRESCRIPTION = `CITY HEART CLINIC (FICTIONAL DEMONSTRATION DOCUMENT)
Not a real prescription. Do not act on anything written here.

Patient Name: Asha Verma
Date: ${inDays(-21).split('-').reverse().join('-')}
Dr. R. Nair, MD Cardiology

Rx
1. Tab Fictamol 500mg   1-0-1   after food
2. Cap Placebex 20mg    0-0-1   at bedtime

Review after 4 weeks
Report No: DEMO-RX-4471
`;

const LAB = `SUNRISE DIAGNOSTICS LABORATORY (FICTIONAL DEMONSTRATION DOCUMENT)
All values below are invented for a software demo and are medically meaningless.

Patient: Asha Verma
Specimen collected: ${inDays(-9).split('-').reverse().join('-')}

Test            Result   Units    Reference Range
Haemoglobin     12.6     g/dL     12.0 - 15.0
HbA1c            6.1     %        4.0 - 5.6

Lab No DEMO-LAB-2026-0881
Follow up on ${inDays(21)} with the treating physician.
`;

const rx = await uploadDocument({
  actorUserId: asha, careProfileId: ashaProfile,
  filename: 'fictional-prescription.txt', declaredMime: 'text/plain',
  bytes: Buffer.from(PRESCRIPTION, 'utf8'),
  title: 'Cardiology prescription (fictional)', category: 'prescription', isDemo: true,
});
confirmDocumentMetadata({
  actorUserId: asha, documentId: rx.documentId,
  title: 'Cardiology prescription (fictional)', category: 'prescription',
  documentDate: inDays(-21), providerName: 'Dr. R. Nair',
  notes: 'FICTIONAL demo document.', tags: ['cardiology', 'demo'],
  sensitivity: 'standard', fromSuggestion: true,
});

const lab = await uploadDocument({
  actorUserId: asha, careProfileId: ashaProfile,
  filename: 'fictional-lab-report.txt', declaredMime: 'text/plain',
  bytes: Buffer.from(LAB, 'utf8'),
  title: 'Blood work (fictional)', category: 'lab_report', isDemo: true,
});
confirmDocumentMetadata({
  actorUserId: asha, documentId: lab.documentId,
  title: 'Blood work (fictional)', category: 'lab_report',
  documentDate: inDays(-9), providerName: 'Sunrise Diagnostics',
  notes: 'FICTIONAL demo document. Values are invented.', tags: ['pathology', 'demo'],
  sensitivity: 'standard', fromSuggestion: true,
});

// A restricted document, to demonstrate per-document sharing.
const restricted = await uploadDocument({
  actorUserId: asha, careProfileId: ashaProfile,
  filename: 'fictional-private-note.txt', declaredMime: 'text/plain',
  bytes: Buffer.from(
    'FICTIONAL DEMONSTRATION DOCUMENT\nA private note Asha has chosen not to share widely.\n', 'utf8'),
  title: 'Private note (fictional, restricted)', category: 'other',
  sensitivity: 'restricted', isDemo: true,
});
confirmDocumentMetadata({
  actorUserId: asha, documentId: restricted.documentId,
  title: 'Private note (fictional, restricted)', category: 'other',
  documentDate: inDays(-3), providerName: null, notes: 'Restricted on purpose.',
  tags: ['demo'], sensitivity: 'restricted', fromSuggestion: false,
});

// ---- appointment -------------------------------------------------------------
const appointment = createAppointment({
  actorUserId: asha, careProfileId: ashaProfile,
  title: 'Cardiology review (demo)', startsAt: localToUtc(inDays(4), '09:30', TZ), timezone: TZ,
  providerName: 'Dr. R. Nair', location: 'City Heart Clinic, Lajpat Nagar (fictional)',
  durationMinutes: 30, responsibleUserId: priya, status: 'confirmed', isDemo: true,
  notes: 'FICTIONAL demo appointment.',
});
addPrepItem({ actorUserId: asha, appointmentId: appointment, kind: 'question',
  text: 'Ask whether the evening tablet can be taken earlier.' });
addPrepItem({ actorUserId: asha, appointmentId: appointment, kind: 'question',
  text: 'Ask what the HbA1c result means for the current routine.' });
addPrepItem({ actorUserId: asha, appointmentId: appointment, kind: 'transport',
  text: 'Priya is driving; leave by 8:45 am.' });
addPrepItem({ actorUserId: asha, appointmentId: appointment, kind: 'instruction',
  text: 'Clinic asked us to bring the previous prescription.', source: 'clinician_provided' });
linkDocument(asha, appointment, rx.documentId);
linkDocument(asha, appointment, lab.documentId);

// ---- care tasks --------------------------------------------------------------
const collect = createTask({
  actorUserId: asha, careProfileId: ashaProfile,
  title: 'Collect the blood work report from the lab',
  description: 'Reception desk at Sunrise Diagnostics (fictional).',
  assigneeUserId: arun, dueAt: localToUtc(inDays(-1), '17:00', TZ),
  priority: 'normal', isDemo: true,
});
setTaskStatus({ actorUserId: arun, taskId: collect, status: 'accepted' });
setTaskStatus({ actorUserId: arun, taskId: collect, status: 'completed',
  note: 'Collected and uploaded to the vault.' });

const pharmacy = createTask({
  actorUserId: asha, careProfileId: ashaProfile,
  title: 'Re-order this month\'s tablets',
  description: 'Pharmacy on the corner keeps both in stock (fictional).',
  assigneeUserId: priya, dueAt: localToUtc(inDays(2), '11:00', TZ),
  priority: 'high', isDemo: true, appointmentId: appointment,
});
setTaskStatus({ actorUserId: priya, taskId: pharmacy, status: 'accepted' });

createTask({
  actorUserId: asha, careProfileId: ashaProfile,
  title: 'Send the claim form to the insurer',
  assigneeUserId: null, dueAt: localToUtc(inDays(6), '12:00', TZ),
  priority: 'low', isDemo: true,
});

// A pending handover, so the workflow is visible in the demo.
requestHandover({
  actorUserId: priya, taskId: pharmacy, toUserId: arun,
  reason: 'Work trip on Thursday — can you pick these up?',
});

// ---- medication routine ------------------------------------------------------
const schedule = createSchedule({
  actorUserId: asha, careProfileId: ashaProfile,
  medicationName: 'Fictamol (demo medicine)', strength: '500 mg', form: 'tablet',
  doseInstruction: '1 tablet twice a day after food',
  instructionSource: 'clinician_written',
  prescriptionDocumentId: rx.documentId,
  timesOfDay: ['09:00', '21:00'], startDate: inDays(-21), timezone: TZ,
  refillReminderDate: inDays(5), isDemo: true,
  notes: 'FICTIONAL demo routine. Not a real medicine.',
});

// One self-reported check-in; the rest stay unconfirmed on purpose, which is
// what the real product looks like.
recordCheckin({
  actorUserId: asha, scheduleId: schedule,
  scheduledFor: localToUtc(today, '09:00', TZ), status: 'taken',
  note: 'Taken with breakfast.',
});

setAvailability({
  userId: priya, circleId: circle, status: 'unavailable',
  fromDate: inDays(3), toDate: inDays(4), note: 'Work trip to Pune (fictional)',
});

const generated = tick();

console.log(`
Demo data created. Everything in it is fictional.

  Sign in at http://localhost:3100/login with password: ${PASSWORD}

  ${PEOPLE.asha.email}
      Asha — owns her profile and controls all access.
  ${PEOPLE.priya.email}
      Priya — authorised caregiver: appointments, records, tasks, medications, activity.
  ${PEOPLE.arun.email}
      Arun  — authorised for tasks and appointments ONLY. He deliberately cannot
              read documents or medications, which demonstrates the permission model.

  Seeded: 1 care profile, 1 circle, 2 caregivers, 3 documents (one restricted),
          1 appointment with a 4-item preparation packet, 3 care tasks (1 completed,
          1 with a pending handover, 1 unassigned), 1 medication routine with
          1 self-reported check-in, ${generated.generated} generated notification(s).

  Rebuild at any time with: npm run reset:demo
`);
