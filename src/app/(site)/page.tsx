import Link from 'next/link';
import { ButtonLink, Card, Notice } from '@/components/ui';

export default function HomePage() {
  return (
    <>
      <section className="border-b border-line bg-gradient-to-b from-accent-soft to-bg">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="inline-flex items-center rounded-full border border-accent/30 bg-surface px-3 py-1 text-sm font-semibold text-accent">
                One family. One place for care.
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-ink sm:text-5xl">
                Your family&rsquo;s care, coordinated.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted">
                One secure place to organise medical records, appointments, medication routines,
                and family caregiving responsibilities.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/signup" className="px-6 py-3 text-base">Get started free</ButtonLink>
                <ButtonLink href="/how-it-works" variant="secondary" className="px-6 py-3 text-base">
                  See how CareCircle works
                </ButtonLink>
              </div>
              <p className="mt-5 text-sm text-muted">
                No credit card. Runs locally with no external accounts.
              </p>
            </div>
            <DashboardPreview />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Three questions, always answered
        </h2>
        <p className="mt-3 max-w-2xl text-muted">
          Most families lose track of care in group chats and camera rolls. CareCircle keeps the
          administration in one place, so nothing depends on somebody remembering.
        </p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            { q: 'What needs to happen next?', a: 'Appointments, care tasks and confirmed medication times in one chronological plan.' },
            { q: 'Who has agreed to handle it?', a: 'Every task and appointment has a named person who accepted it — or is visibly unassigned.' },
            { q: 'Has it actually been completed?', a: 'Only a person can mark something done. A reminder going out never counts as completion.' },
          ].map((item) => (
            <Card key={item.q} className="p-6">
              <p className="text-lg font-semibold text-ink">{item.q}</p>
              <p className="mt-2 text-muted">{item.a}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Built so the patient keeps control
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              { t: 'Health Vault', d: 'Prescriptions, lab reports and discharge summaries, encrypted on disk and reachable only through an authorised download.' },
              { t: 'Care Planner', d: 'A shared calendar of appointments and tasks, each with an owner, a due date and a status history.' },
              { t: 'Family Circles', d: 'Invite relatives by link. Joining a circle shares nothing by itself — each permission is granted on purpose.' },
              { t: 'Circle Assistant', d: 'Finds your documents and builds appointment checklists from what is actually recorded. It never gives medical advice.' },
            ].map((f) => (
              <div key={f.t}>
                <p className="font-semibold text-ink">{f.t}</p>
                <p className="mt-1.5 text-sm text-muted">{f.d}</p>
              </div>
            ))}
          </div>
          <p className="mt-8">
            <Link href="/features" className="font-semibold text-accent hover:underline">
              See every feature →
            </Link>
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-10 lg:grid-cols-2">
          <VaultPreview />
          <PlannerPreview />
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Privacy is the product, not a setting
          </h2>
          <ul className="mt-6 space-y-4 text-muted">
            {[
              ['Being an administrator is not access.', 'Whoever runs a family circle gets the roster — not everybody’s medical records. Access is granted record by record, by the person it belongs to.'],
              ['Permissions are enforced on the server.', 'Every read is checked against a grant before a row is ever selected. Hiding a button is not a permission.'],
              ['Withdrawal is immediate.', 'Revoking access stops working on the next request, and the withdrawal is written to a consent ledger you can read.'],
              ['Documents are encrypted at rest.', 'Files are stored with AES-256-GCM outside the web root. There is no guessable URL to a medical record.'],
              ['Your data leaves when you do.', 'Export everything as JSON, or delete the account and its files, without paying for anything.'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span aria-hidden="true" className="mt-1 text-accent">●</span>
                <span><strong className="font-semibold text-ink">{t}</strong> {d}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8">
            <Link href="/privacy" className="font-semibold text-accent hover:underline">
              Read the privacy policy draft →
            </Link>
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Simple pricing</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <Card className="p-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">CareCircle Free</p>
            <p className="mt-2 text-4xl font-bold text-ink">₹0</p>
            <ul className="mt-5 space-y-2 text-muted">
              {['One care profile for yourself', 'Medical document storage', 'Appointment tracking',
                'Medication reminders you confirm', 'Personal care tasks'].map((x) => (
                <li key={x}>• {x}</li>
              ))}
            </ul>
            <ButtonLink href="/signup" className="mt-6 w-full">Get started free</ButtonLink>
          </Card>
          <Card className="border-accent/40 p-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">
              CareCircle Family — proposed
            </p>
            <p className="mt-2 text-4xl font-bold text-ink">₹199<span className="text-base font-medium text-muted">/month</span></p>
            <ul className="mt-5 space-y-2 text-muted">
              {['Multiple family profiles', 'Shared care coordination', 'Extended document capacity',
                'Caregiver handovers', 'Family permissions and activity summaries'].map((x) => (
                <li key={x}>• {x}</li>
              ))}
            </ul>
            <p className="mt-6 rounded-card border border-line bg-sunken px-4 py-3 text-sm text-muted">
              Billing is not implemented. No payment provider is connected and nothing can be
              charged. Every feature is available in this build.
            </p>
          </Card>
        </div>
        <p className="mt-6">
          <Link href="/pricing" className="font-semibold text-accent hover:underline">
            Full pricing details →
          </Link>
        </p>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Common questions</h2>
          <div className="mt-6 space-y-3">
            {[
              ['Is this medical advice?', 'No. CareCircle organises records, appointments and responsibilities. It never diagnoses, prescribes, changes a dose or assesses an emergency.'],
              ['Who can see my records?', 'Only you, plus anyone you have explicitly granted a specific permission to. Being in the same family circle is not access.'],
              ['Does it connect to ABDM or ABHA?', 'No. There is no health-information-exchange integration in this build, and none is implied anywhere in the app.'],
              ['Will I get SMS or email reminders?', 'Not in this build. Reminders appear in the in-app notification centre. No SMS or email provider is configured, so none is promised.'],
            ].map(([q, a]) => (
              <details key={q} className="rounded-card border border-line bg-surface-2 px-4 py-3">
                <summary className="cursor-pointer font-semibold text-ink">{q}</summary>
                <p className="mt-2 text-muted">{a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6">
            <Link href="/faq" className="font-semibold text-accent hover:underline">All questions →</Link>
          </p>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- previews
   Every preview below uses invented names and values and says so. No real
   patient information, no fabricated customer counts, no testimonials.      */

function PreviewFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <span className="rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-warn">
          Example data
        </span>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function DashboardPreview() {
  return (
    <PreviewFrame title="Today — the Sharma family (fictional)">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[['2', 'Appointments'], ['3', 'Open tasks'], ['1', 'Unconfirmed dose']].map(([n, l]) => (
          <div key={l} className="rounded-card border border-line bg-surface-2 p-3">
            <p className="text-2xl font-bold text-ink">{n}</p>
            <p className="text-xs text-muted">{l}</p>
          </div>
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {[
          ['9:30 am', 'Cardiology review — Dr. R. Nair', 'Priya is taking her'],
          ['1:00 pm', 'Collect lab report', 'Arun accepted'],
          ['8:00 pm', 'Evening medication', 'Awaiting confirmation'],
        ].map(([time, what, who]) => (
          <li key={what} className="flex flex-wrap items-baseline gap-x-2 rounded-card border border-line px-3 py-2">
            <span className="font-mono text-xs text-muted">{time}</span>
            <span className="font-medium text-ink">{what}</span>
            <span className="ml-auto text-xs text-accent">{who}</span>
          </li>
        ))}
      </ul>
      <Notice tone="warn" className="mt-3">
        A dose with no confirmation is shown as a question, never as a missed dose.
      </Notice>
    </PreviewFrame>
  );
}

function VaultPreview() {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-ink">Health Vault</h2>
      <p className="mt-3 text-muted">
        Upload a prescription or report and CareCircle reads what it can locally, then asks you to
        check every field before anything is saved. The original file always stays the source of truth.
      </p>
      <PreviewFrame title="Review extracted details (fictional document)">
        <dl className="space-y-2 text-sm">
          {[
            ['Category', 'Prescription', 'suggested'],
            ['Document date', '14 Mar 2026', 'suggested'],
            ['Provider', 'Dr. R. Nair', 'suggested'],
            ['Follow-up date', 'Not set', 'left blank on purpose'],
          ].map(([k, v, tag]) => (
            <div key={k} className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-0">
              <dt className="w-32 text-muted">{k}</dt>
              <dd className="font-medium text-ink">{v}</dd>
              <span className="ml-auto rounded-full bg-sunken px-2 py-0.5 text-[0.7rem] text-muted">{tag}</span>
            </div>
          ))}
        </dl>
        <Notice tone="neutral" className="mt-3">
          The document said &ldquo;review after 4 weeks&rdquo;. That is shown to you as written and
          never turned into a date automatically.
        </Notice>
      </PreviewFrame>
    </div>
  );
}

function PlannerPreview() {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-ink">Care Planner</h2>
      <p className="mt-3 text-muted">
        Responsibilities are explicit. When somebody cannot make it, they request a handover and
        another authorised person accepts it — the trail stays in the task history.
      </p>
      <PreviewFrame title="Handover request (fictional)">
        <div className="rounded-card border border-line bg-surface-2 p-3 text-sm">
          <p className="font-semibold text-ink">Take Amma to the cardiology review</p>
          <p className="mt-1 text-muted">Priya asked Arun to take over — &ldquo;work trip on Thursday&rdquo;.</p>
          <ul className="mt-3 space-y-1 text-xs text-muted">
            <li>✓ Arun already has permission to see tasks for this profile</li>
            <li>✓ Accepting moves the responsibility, and nothing else</li>
            <li>✓ No medical record becomes visible because of a handover</li>
          </ul>
        </div>
      </PreviewFrame>
    </div>
  );
}
