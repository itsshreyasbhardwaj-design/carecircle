import { ButtonLink, Card, PageHead } from '@/components/ui';

export const metadata = { title: 'For families' };

const SCENARIOS: { who: string; problem: string; how: string[] }[] = [
  {
    who: 'An adult child coordinating a parent’s care from another city',
    problem:
      'Prescriptions arrive as photographs in a chat. Appointments live in somebody’s head. Nobody is sure whether the follow-up was booked.',
    how: [
      'Your parent keeps their own profile and decides what you can see.',
      'They share "see appointments" and "see care tasks" with you, and keep their records private if they prefer.',
      'You create the tasks, assign the sibling who lives nearby, and see when it is actually marked done.',
    ],
  },
  {
    who: 'Siblings splitting responsibility for one parent',
    problem:
      'Two people both assume the other booked the cardiology review. Neither did.',
    how: [
      'Every appointment has one named responsible person, or is visibly unassigned.',
      'When one of you travels, you request a handover and the other accepts it explicitly.',
      'Availability is recorded, so nobody is assigned a visit during their work trip.',
    ],
  },
  {
    who: 'A spouse managing several routines at once',
    problem:
      'Four medicines, different times, and no reliable way to know whether the evening dose was taken.',
    how: [
      'Each routine stores the instruction exactly as the prescription reads, plus who confirmed it.',
      'Every dose slot is answered individually: taken, skipped, or still unconfirmed.',
      'An unanswered slot is shown as a question for a person to resolve — never as a missed dose.',
    ],
  },
  {
    who: 'Someone managing their own long-term condition',
    problem:
      'Years of reports spread across email, a phone gallery and a folder at home.',
    how: [
      'Upload once; the timeline sorts by document date, not upload date.',
      'Search finds text inside the documents, not just their filenames.',
      'Share one specific report with one relative for one week, then let it expire.',
    ],
  },
];

export default function ForFamiliesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <PageHead
        title="For families"
        sub="Four situations this was built around. The names and details below are illustrative."
      />
      <div className="mt-10 space-y-6">
        {SCENARIOS.map((s) => (
          <Card key={s.who} className="p-6">
            <h2 className="text-lg font-semibold text-ink">{s.who}</h2>
            <p className="mt-2 text-muted"><strong className="text-ink">What goes wrong:</strong> {s.problem}</p>
            <ul className="mt-3 space-y-1.5 text-muted">
              {s.how.map((h) => (
                <li key={h} className="flex gap-2">
                  <span aria-hidden="true" className="mt-1 text-accent">●</span><span>{h}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="mt-8 p-6">
        <h2 className="text-lg font-bold text-ink">About children and dependent adults</h2>
        <p className="mt-2 text-muted">
          CareCircle is built for adults who manage their own records and explicitly authorise
          caregivers. Managing records on behalf of a child, or of an adult who cannot consent,
          needs a proxy-authorisation process that has been through legal review. That does not
          exist yet, so profiles marked as dependents stay restricted: you can keep notes and
          coordinate tasks, but the full record features are deliberately switched off rather
          than granted on the strength of a tick-box.
        </p>
      </Card>

      <div className="mt-10">
        <ButtonLink href="/signup" className="px-6 py-3 text-base">Get started free</ButtonLink>
      </div>
    </div>
  );
}
