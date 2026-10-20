import { Card, PageHead, SafetyNote } from '@/components/ui';

export const metadata = { title: 'Features' };

const GROUPS = [
  {
    title: 'Health Vault',
    items: [
      ['Document storage', 'Prescriptions, lab reports, visit records, discharge summaries, referral letters, vaccination records and insurance papers.'],
      ['Local text extraction', 'PDF text is read directly. Photographs are read with an offline OCR model, once you enable it with a single setup command.'],
      ['Review before saving', 'Suggested category, date, provider and reference numbers are shown for you to correct. Nothing is stored until you confirm it.'],
      ['Version history', 'Replace a document with a clearer scan and the earlier version stays readable.'],
      ['Duplicate review', 'Identical files are flagged for you to compare. Nothing is ever deleted automatically.'],
      ['Full-text search', 'Search titles, notes, providers and extracted text — restricted to documents you may read.'],
      ['Medical timeline', 'A chronological view you can filter by person, type, date, provider or tag.'],
    ],
  },
  {
    title: 'Care Planner',
    items: [
      ['Appointments', 'Provider, location, time zone, notes, status and a named responsible person.'],
      ['Status history', 'Proposed, scheduled, confirmed, completed, cancelled or rescheduled — with the original kept when a visit moves.'],
      ['Preparation packets', 'Questions for the doctor, transport arrangements, documents to bring and admin to finish first.'],
      ['Care tasks', 'Assignee, due date, priority, comments and a full activity history.'],
      ['Explicit completion', 'A task is complete only when a person marks it so. Sending a reminder never completes anything.'],
      ['Caregiver handovers', 'Request a transfer, the other person accepts, and the responsibility moves — without widening access to records.'],
      ['Caregiver availability', 'Record who is away, so the family can see who can realistically take something on.'],
    ],
  },
  {
    title: 'Medication routines',
    items: [
      ['Confirmed instructions only', 'Every routine records the instruction verbatim plus who confirmed it and in what capacity.'],
      ['Dose slots', 'Reminder times generate individual slots so each one can be answered.'],
      ['Honest check-ins', 'Taken, skipped, not confirmed or snoozed. Opening the app proves nothing and changes nothing.'],
      ['Refill reminders', 'An optional date to re-order, kept separate from dose reminders.'],
      ['Caregiver visibility', 'An authorised caregiver can see self-reported check-ins, labelled as self-reported.'],
    ],
  },
  {
    title: 'Family circles and permissions',
    items: [
      ['Private circles', 'Create a circle, invite relatives, manage the roster, leave when you want.'],
      ['Invitation links', 'Unguessable tokens that expire in seven days, can be revoked, and state exactly what accepting will share.'],
      ['Ten separate permissions', 'View or manage appointments, read or add documents, view or manage medications, view or update tasks, see activity.'],
      ['Per-document sharing', 'Mark a document restricted and share just that one file with just one person.'],
      ['Time-limited access', 'Give a permission an expiry date for someone covering a single week.'],
      ['Immediate withdrawal', 'Revoking takes effect on the server at once, and removing someone from a circle withdraws what that circle shared.'],
      ['Consent ledger', 'Every grant, expiry and withdrawal is recorded with who, what, why and when.'],
    ],
  },
  {
    title: 'Coordination and insight',
    items: [
      ['Today dashboard', 'What is happening, who owns it and what is unanswered — generated from the database, never from sample data.'],
      ['Circle Assistant', 'Finds records, builds appointment checklists, surfaces follow-ups awaiting confirmation and writes a family care brief.'],
      ['Activity timeline', 'A per-row permission-filtered feed, so two people in one circle correctly see different things.'],
      ['Coordination analytics', 'Open, overdue and unassigned work, handovers and document activity — each with the definition used to compute it.'],
      ['Notification centre', 'Unread counts, snooze, dismiss and an explicit acknowledge that is distinct from merely reading.'],
      ['Audit history', 'Your own security-relevant events, and who has touched the profiles you own.'],
      ['Export and deletion', 'Download everything as JSON or delete the account and its encrypted files. Never behind a payment.'],
    ],
  },
  {
    title: 'Accessibility',
    items: [
      ['Designed for older adults', 'Generous base type, 44px touch targets, visible focus rings and plain language.'],
      ['Keyboard and screen reader', 'Real labels, native controls, a skip link and live regions for form errors.'],
      ['Light and dark', 'A complete second theme, following the system or set explicitly.'],
      ['Larger text and reduced motion', 'Saved to your account, applied server-side with no flash.'],
      ['English, Hindi and Bengali', 'Hand-written translations for navigation and common messages. Clinical text is never machine-translated.'],
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <PageHead
        title="Everything in CareCircle"
        sub="This list describes what the application actually does today. Anything not built is on the roadmap, not here."
      />
      <div className="mt-6"><SafetyNote /></div>
      <div className="mt-10 space-y-10">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="text-xl font-bold tracking-tight text-ink">{group.title}</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {group.items.map(([t, d]) => (
                <Card key={t} className="p-5">
                  <p className="font-semibold text-ink">{t}</p>
                  <p className="mt-1.5 text-sm text-muted">{d}</p>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
      <Card className="mt-10 p-6">
        <h2 className="text-lg font-bold text-ink">Not in this build</h2>
        <p className="mt-2 text-muted">
          So there is no doubt: there is no SMS or email delivery, no push notifications, no
          payment processing, no ABDM or ABHA integration, no hospital or clinic system
          connection, no wearable sync, and no external AI service. None of these is presented
          as working anywhere in the product.
        </p>
      </Card>
    </div>
  );
}
