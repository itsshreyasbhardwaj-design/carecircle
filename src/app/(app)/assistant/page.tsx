import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { ask } from '@/lib/assistant';
import {
  Badge, Card, CardHead, Field, Input, Notice, PageHead, SafetyNote,
} from '@/components/ui';

export const metadata = { title: 'Circle Assistant' };

const EXAMPLES = [
  'Find the latest lab report',
  'What do I need to prepare for the next appointment?',
  'What follow-ups are outstanding?',
  'Give me a brief for this week',
];

export default async function AssistantPage({ searchParams }: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q } = await searchParams;
  const answer = q?.trim() ? ask(user.id, q) : null;

  return (
    <div className="space-y-6">
      <PageHead title="Circle Assistant"
                sub="Finds and organises what is already in CareCircle. It does not give medical advice." />

      <Card>
        {/* A GET form: the question lives in the URL, so an answer is shareable
            and re-runnable, and no client-side state is needed. */}
        <form method="get" action="/assistant" className="space-y-4 p-5">
          <Field label="What do you need?" name="q"
                 hint="Plain words are fine. I recognise requests to find records, prepare for an appointment, list follow-ups, or summarise the week.">
            <Input name="q" type="search" defaultValue={q ?? ''} autoFocus maxLength={400}
                   placeholder="Find the report from the last cardiology visit" />
          </Field>
          <button type="submit"
            className="cc-btn rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink">
            Ask
          </button>
          <div className="flex flex-wrap gap-2 pt-1">
            {EXAMPLES.map((e) => (
              <Link key={e} href={`/assistant?q=${encodeURIComponent(e)}`}
                className="rounded-full border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink hover:border-accent">
                {e}
              </Link>
            ))}
          </div>
        </form>
      </Card>

      {answer ? (
        <Card className={answer.intent === 'clinical_refusal' ? 'border-warn/50' : ''}>
          <CardHead title={answer.headline} sub={answer.summary ?? undefined}
                    action={<Badge tone={answer.intent === 'clinical_refusal' ? 'warn' : 'accent'}>
                      {answer.intent.replace(/_/g, ' ')}
                    </Badge>} />
          <div className="divide-y divide-line">
            {answer.sections.map((section) => (
              <section key={section.title} className="px-5 py-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                  {section.title}
                </h3>
                {section.items.length === 0 ? (
                  <p className="mt-2 text-sm text-faint">
                    {section.empty ?? 'Nothing to show.'}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {section.items.map((item, i) => (
                      <li key={`${section.title}-${i}`}
                          className="rounded-card border border-line bg-surface-2 px-3 py-2.5">
                        {item.link ? (
                          <Link href={item.link} className="font-medium text-ink hover:text-accent">
                            {item.text}
                          </Link>
                        ) : (
                          <p className="text-[0.95rem] text-ink">{item.text}</p>
                        )}
                        {item.source ? (
                          <p className="text-xs text-faint">{item.source}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {answer.sources.length > 0 ? (
            <div className="border-t border-line px-5 py-4">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                Where this came from
              </h3>
              <p className="mt-1 text-sm text-muted">
                Every statement above is built from these records. Open any of them to check it.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {answer.sources.slice(0, 12).map((s, i) => (
                  <li key={`${s.link}-${i}`}>
                    <Link href={s.link}
                      className="inline-block max-w-72 truncate rounded-full border border-accent/40 bg-accent-soft px-3 py-1 text-sm text-accent">
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {answer.caveats.length > 0 ? (
            <div className="border-t border-line px-5 py-4">
              <ul className="space-y-1.5 text-sm text-muted">
                {answer.caveats.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span aria-hidden="true" className="text-warn">!</span><span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Notice tone="neutral" title="How the assistant works">
        It is not a language model and it does not call any external service. It recognises an
        intent from the words you use, runs the same permission-checked database queries the rest
        of the app uses, and fills a fixed template with the results. That means two things: it
        cannot invent a fact, and it cannot show you a record you are not allowed to read. If you
        ask a clinical question it will decline and point you to a clinician.
      </Notice>

      <SafetyNote />
    </div>
  );
}
