import { ButtonLink, Card, PageHead } from '@/components/ui';

export const metadata = { title: 'How it works' };

const STEPS: [string, string][] = [
  ['Create your own profile', 'You sign up and get one care profile: yours. You control it. Nobody else can see anything in it until you decide otherwise.'],
  ['Start a family circle', 'Name a circle — "Amma’s care", "The Sharmas" — and invite relatives with a link you copy and send however you like.'],
  ['Share specific permissions', 'Joining a circle shares nothing. You tick the exact permissions each person should have, say why, and optionally set an expiry.'],
  ['Put the admin in one place', 'Upload documents, add appointments, record medication routines a clinician or the patient confirmed, and create the tasks around them.'],
  ['Give every job an owner', 'Assign the person who agreed to do it. If they cannot, they request a handover and someone else accepts. The history stays.'],
  ['Check the day, not the group chat', 'The Today dashboard shows what is next, who has it, and what nobody has answered yet.'],
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <PageHead title="How CareCircle works" sub="Six steps, in the order you would actually do them." />
      <ol className="mt-10 space-y-5">
        {STEPS.map(([title, body], i) => (
          <li key={title}>
            <Card className="flex gap-5 p-6">
              <span aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg font-bold text-accent">
                {i + 1}
              </span>
              <div>
                <h2 className="text-lg font-semibold text-ink">{title}</h2>
                <p className="mt-1.5 text-muted">{body}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <Card className="mt-10 p-6">
        <h2 className="text-lg font-bold text-ink">What happens when you upload a document</h2>
        <ol className="mt-3 space-y-2 text-muted">
          {[
            'The file type is checked against its actual contents, not just what the browser claims.',
            'It is encrypted with AES-256-GCM and written outside the web root.',
            'Text is extracted locally — from the PDF text layer, or with an offline OCR model for photographs.',
            'Rules suggest a category and pick out dates, a provider and reference numbers.',
            'You review every suggestion and correct whatever is wrong.',
            'Only what you confirm is saved. The original file remains the authoritative copy.',
          ].map((s, i) => <li key={s}><strong className="text-ink">{i + 1}.</strong> {s}</li>)}
        </ol>
        <p className="mt-4 rounded-card border border-line bg-sunken px-4 py-3 text-sm text-muted">
          A phrase like &ldquo;review after 4 weeks&rdquo; is shown to you exactly as written.
          CareCircle will not turn a clinician&rsquo;s instruction into a date or a schedule on its own.
        </p>
      </Card>

      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/signup" className="px-6 py-3 text-base">Get started free</ButtonLink>
        <ButtonLink href="/for-families" variant="secondary" className="px-6 py-3 text-base">
          Read the family scenarios
        </ButtonLink>
      </div>
    </div>
  );
}
