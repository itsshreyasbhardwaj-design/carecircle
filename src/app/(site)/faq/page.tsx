import { PageHead, SafetyNote } from '@/components/ui';

export const metadata = { title: 'FAQ' };

const SECTIONS: { title: string; qa: [string, string][] }[] = [
  {
    title: 'What this is',
    qa: [
      ['Is CareCircle medical advice?',
       'No. It organises records, appointments, medication routines and family responsibilities. It never diagnoses a condition, prescribes or changes a medicine, interprets a result, judges an emergency, or recommends treatment. Those are decisions for a qualified clinician.'],
      ['Is it an emergency service?',
       'No. Do not rely on it for anything urgent. Use your local emergency number.'],
      ['Does the assistant use AI?',
       'Not an external AI service. The Circle Assistant recognises an intent from keywords, runs the same permission-checked database queries the rest of the app uses, and fills a fixed template with the results. Every statement it makes links to a record you can open and check. It will not answer a clinical question at all.'],
    ],
  },
  {
    title: 'Privacy and access',
    qa: [
      ['Who can see my records?',
       'You, plus anyone you have granted a specific permission to. There are ten separate permissions and you grant them one at a time, with a stated purpose and an optional expiry date.'],
      ['Does running a family circle give me access to everyone’s records?',
       'No, and this is deliberate. A circle coordinator can manage the roster and send invitations. That confers no access to anybody’s appointments, documents, medications or tasks.'],
      ['What happens when I withdraw access?',
       'It stops working on the server immediately — the next request from that person is refused. The withdrawal is also written to a consent ledger you can read, with who, what, why and when.'],
      ['Can someone gain access by being handed a task?',
       'No. A handover can only be offered to someone who already has permission to see that profile’s tasks. If they do not, the request is refused and you are told to share the permission deliberately first.'],
      ['How are documents stored?',
       'Encrypted with AES-256-GCM in a directory outside the web root. There is no public or guessable URL to a medical record; every download goes through an authorisation check and is written to the audit log.'],
      ['Can I get my data out?',
       'Yes, as a JSON file covering your account, profiles, documents metadata, appointments, tasks, medication routines, check-ins, consent history and your own activity log. You can also delete the account and its encrypted files.'],
    ],
  },
  {
    title: 'Reminders',
    qa: [
      ['Will I get an SMS or an email?',
       'No. No SMS gateway or email provider is configured, so the product does not claim to send either. Reminders appear in the in-app notification centre.'],
      ['Are reminders reliable?',
       'Within an honest limit. Reminders are generated when the scheduler runs, which happens when a signed-in person loads a page, or when you press "Run scheduler" on the notifications page. Nothing is lost while the server is off: when it next runs it catches up on everything already due. A production deployment would need a real background worker, which is documented rather than pretended.'],
      ['If I get a medication reminder, does the app know whether I took it?',
       'Only if a person tells it. Each dose slot stays "not confirmed" until someone records taken or skipped. Opening the app, reading the notification or dismissing it changes nothing. An unconfirmed slot is displayed as an open question, not as a missed dose.'],
    ],
  },
  {
    title: 'Integrations and the Indian context',
    qa: [
      ['Does it connect to ABDM or ABHA?',
       'No. There is no health-information-exchange integration, no ABHA linking and no government approval. Interfaces exist in the codebase where such an integration would attach, and they are documented as deferred.'],
      ['Is it connected to my hospital or clinic?',
       'No. There is no hospital or clinic system connection of any kind.'],
      ['Is it compliant with Indian data protection law?',
       'Technical controls are in place — explicit consent records, purpose limitation, access withdrawal, export and deletion, encryption at rest, audit logging. That is engineering, not a compliance certificate. A public launch handling real health data needs legal review, a published notice, a grievance mechanism, security testing by someone independent, and breach procedures. Those are not claimed here.'],
      ['Which dates and times does it use?',
       'Day-month-year with a 12-hour clock, and Asia/Kolkata by default. The time zone is configurable and every instant is stored in UTC, so a routine keeps its meaning if you travel.'],
    ],
  },
  {
    title: 'Practical',
    qa: [
      ['What can I upload?',
       'PDF, JPEG, PNG, WebP, HEIC and plain text, up to 15 MB. The contents are checked against the stated type, so a file pretending to be an image is refused.'],
      ['Can it read a photograph of a prescription?',
       'Yes, with an offline OCR model you enable once by running a single setup command. It downloads a language file and then runs entirely on your machine with no network access. Until then, photographs are accepted and stored, and the app plainly says it could not read any text rather than guessing.'],
      ['I forgot my password. Can I reset it?',
       'With the recovery code shown once when you signed up. There is deliberately no "email me a reset link", because no mail provider is configured and offering a link that cannot be sent would be dishonest.'],
      ['Can I use it in Hindi or Bengali?',
       'Navigation and common interface messages are translated by hand. Clinical content — dose instructions, document text, your notes — is always shown in the words that were actually entered, never machine-translated.'],
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <PageHead title="Questions and answers" sub="Plain answers, including about what this product cannot do." />
      <div className="mt-6"><SafetyNote /></div>
      <div className="mt-10 space-y-10">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-xl font-bold tracking-tight text-ink">{section.title}</h2>
            <div className="mt-4 space-y-3">
              {section.qa.map(([q, a]) => (
                <details key={q} className="rounded-card border border-line bg-surface px-4 py-3">
                  <summary className="cursor-pointer font-semibold text-ink">{q}</summary>
                  <p className="mt-2 text-muted">{a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
