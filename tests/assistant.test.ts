import { beforeEach, describe, expect, it } from 'vitest';
import { makeProfile, makeUser, resetDb } from './helpers.ts';
import { ask, detectClinicalQuestion } from '../src/lib/assistant.ts';
import { uploadDocument, confirmDocumentMetadata } from '../src/lib/documents.ts';
import { createAppointment, addPrepItem, linkDocument } from '../src/lib/appointments.ts';
import { createTask } from '../src/lib/tasks.ts';
import { grantAccess } from '../src/lib/consent.ts';

const TZ = 'Asia/Kolkata';

// Invented content throughout.
const CARDIO = Buffer.from(`CITY HEART CLINIC
Patient: Asha Verma
Date: 14-03-2026
Dr. R. Nair, MD Cardiology
Echo report shows values within the stated reference range.
Review after 4 weeks
Report No: DEMO-4471
`, 'utf8');

async function household() {
  const owner = makeUser('Asha');
  const caregiver = makeUser('Priya');
  const stranger = makeUser('Nobody');
  const profile = makeProfile(owner.id, 'Asha Verma');

  const doc = await uploadDocument({
    actorUserId: owner.id, careProfileId: profile, filename: 'cardio.txt',
    declaredMime: 'text/plain', bytes: CARDIO,
    title: 'Cardiology echo report', category: 'lab_report',
  });
  confirmDocumentMetadata({
    actorUserId: owner.id, documentId: doc.documentId, title: 'Cardiology echo report',
    category: 'lab_report', documentDate: '2026-03-14', providerName: 'Dr. R. Nair',
    notes: null, tags: ['cardiology'], sensitivity: 'standard', fromSuggestion: true,
  });

  const appt = createAppointment({
    actorUserId: owner.id, careProfileId: profile, title: 'Cardiology review',
    startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), timezone: TZ,
    providerName: 'Dr. R. Nair', location: 'City Heart Clinic',
  });
  addPrepItem({ actorUserId: owner.id, appointmentId: appt, kind: 'question',
                text: 'Ask whether the evening tablet can move earlier' });
  linkDocument(owner.id, appt, doc.documentId);
  createTask({ actorUserId: owner.id, careProfileId: profile, title: 'Collect the report' });

  return { owner, caregiver, stranger, profile, doc, appt };
}

describe('circle assistant', () => {
  beforeEach(resetDb);

  it('finds an authorised document and links to the original', async () => {
    const { owner, doc } = await household();
    const answer = ask(owner.id, 'find the cardiology report');
    expect(answer.intent).toBe('find_records');
    const links = answer.sections.flatMap((s) => s.items.map((i) => i.link));
    expect(links).toContain(`/records/${doc.documentId}`);
    // Every claim is traceable to a record.
    expect(answer.sources.length).toBeGreaterThan(0);
  });

  it('returns NOTHING to someone with no access', async () => {
    const { stranger } = await household();
    const answer = ask(stranger.id, 'find the cardiology report');
    const items = answer.sections.flatMap((s) => s.items);
    expect(items.length).toBe(0);
    expect(answer.sources.length).toBe(0);
    // And it does not hint that something exists.
    expect(JSON.stringify(answer)).not.toMatch(/Asha|cardiology echo|Nair/i);
  });

  it('starts returning results the moment access is granted', async () => {
    const { owner, caregiver, profile } = await household();
    expect(ask(caregiver.id, 'find the cardiology report').sources.length).toBe(0);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'helps me read reports', grantedByUserId: owner.id,
    });
    expect(ask(caregiver.id, 'find the cardiology report').sources.length).toBeGreaterThan(0);
  });

  it('builds a preparation packet from what was actually entered', async () => {
    const { owner } = await household();
    const answer = ask(owner.id, 'what do I need to prepare for the next appointment?');
    expect(answer.intent).toBe('appointment_prep');
    const text = JSON.stringify(answer);
    expect(text).toContain('Cardiology review');
    expect(text).toContain('evening tablet');
    expect(text).toContain('City Heart Clinic');
    // It says plainly that it does not invent preparation instructions.
    expect(answer.caveats.join(' ')).toMatch(/does not invent preparation instructions/i);
  });

  it('surfaces follow-ups as drafts and never as created tasks', async () => {
    const { owner } = await household();
    const answer = ask(owner.id, 'what follow-ups are outstanding?');
    expect(answer.intent).toBe('followups');
    expect(answer.summary).toMatch(/Nothing here has been created for you/i);
    // "Review after 4 weeks" produced no date, so no follow-up draft from it.
    const drafts = answer.sections.find((s) => s.title.startsWith('Suggested'))!;
    expect(drafts.items.length).toBe(0);
    expect(answer.caveats.join(' ')).toMatch(/never turned into a date/i);
  });

  it('writes a care brief grounded only in real records', async () => {
    const { owner } = await household();
    const answer = ask(owner.id, 'give me a brief for this week');
    expect(answer.intent).toBe('care_brief');
    expect(answer.summary).toMatch(/Nothing is inferred/i);
    const appointments = answer.sections.find((s) => s.title.includes('Appointments'))!;
    expect(appointments.items.length).toBe(1);
    expect(answer.caveats.join(' ')).toMatch(/does not mean the medicine was missed/i);
  });

  it('a brief for a stranger contains no other family\'s data', async () => {
    const { stranger } = await household();
    const answer = ask(stranger.id, 'give me a brief for this week');
    expect(answer.sections.every((s) => s.items.length === 0)).toBe(true);
    expect(JSON.stringify(answer)).not.toMatch(/Asha|Nair/i);
  });

  it('REFUSES clinical questions instead of answering them', async () => {
    const { owner } = await household();
    const clinical = [
      'should I increase the dose?',
      'is it safe to skip the evening tablet?',
      'what dose should she take?',
      'what does this HbA1c result mean — is it dangerous?',
      'why do I have chest pain',
      'are there side effects or interactions?',
      'can you diagnose this?',
      'how serious is this',
    ];
    for (const q of clinical) {
      expect(detectClinicalQuestion(q)).toBe(true);
      const answer = ask(owner.id, q);
      expect(answer.intent).toBe('clinical_refusal');
      expect(answer.summary).toMatch(/does not give medical advice/i);
      expect(answer.sections.flatMap((s) => s.items).length).toBeGreaterThan(0);
      // It never produces a clinical opinion alongside the refusal.
      expect(answer.sources.length).toBe(0);
    }
  });

  it('does not mistake an ordinary retrieval request for a clinical one', () => {
    for (const q of ['find the latest lab report', 'show me the prescription from March',
                      'what appointments are coming up', 'give me a brief']) {
      expect(detectClinicalQuestion(q)).toBe(false);
    }
  });

  it('offers help rather than guessing when the request is unclear', async () => {
    const { owner } = await household();
    const answer = ask(owner.id, 'hello there');
    expect(answer.intent).toBe('help');
    expect(answer.sources.length).toBe(0);
  });

  it('logs the query without storing its text', async () => {
    const { owner } = await household();
    ask(owner.id, 'find the cardiology report for Asha');
    const { all } = await import('../src/db/index.ts');
    const events = all<{ detail: string }>(
      "SELECT detail FROM audit_events WHERE action = 'assistant:query'",
    );
    expect(events.length).toBe(1);
    // The audit row records shape, not content.
    expect(events[0]!.detail).not.toMatch(/cardiology|Asha/i);
    expect(JSON.parse(events[0]!.detail)).toMatchObject({ intent: 'find_records' });
  });

  it('restricted documents stay out of assistant results', async () => {
    const { owner, caregiver, profile } = await household();
    const secret = await uploadDocument({
      actorUserId: owner.id, careProfileId: profile, filename: 'secret.txt',
      declaredMime: 'text/plain',
      bytes: Buffer.from('CITY HEART CLINIC private cardiology note\n'),
      title: 'Private cardiology note', category: 'lab_report', sensitivity: 'restricted',
    });
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'general reading', grantedByUserId: owner.id,
    });
    const answer = ask(caregiver.id, 'find the cardiology report');
    const links = answer.sections.flatMap((s) => s.items.map((i) => i.link));
    expect(links).not.toContain(`/records/${secret.documentId}`);
    expect(JSON.stringify(answer)).not.toMatch(/Private cardiology note/);
  });
});
