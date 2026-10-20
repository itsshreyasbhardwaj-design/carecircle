import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { familyActivity, myAuditHistory } from '@/lib/activity';
import { coordinationMetrics, profileSummary } from '@/lib/analytics';
import { formatDateTime, relative } from '@/lib/time';
import {
  Badge, Card, CardHead, Disclosure, EmptyState, Field, Flash, PageHead, Select, Stat,
} from '@/components/ui';

export const metadata = { title: 'Activity' };

export default async function ActivityPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;

  const profiles = accessibleProfiles(user.id);
  const activity = familyActivity(user.id, { careProfileId: sp.profile || null, limit: 80 });
  const audit = myAuditHistory(user.id, 60);
  const metrics = coordinationMetrics(user.id);
  const summary = profileSummary(user.id);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Activity and history"
                sub="What has happened across the family, and your own security history." />

      <section>
        <h2 className="text-lg font-bold tracking-tight text-ink">Care coordination</h2>
        <p className="mt-1 text-sm text-muted">
          Administrative measures only. CareCircle does not compute health risk, severity or
          adherence scores, and it never will.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <Stat key={m.key} label={m.label} value={m.value} tone={m.tone}
                  definition={m.definition} href={m.link} />
          ))}
        </div>
      </section>

      {summary.length > 0 ? (
        <Card>
          <CardHead title="Per person" sub="Only counts you are permitted to see." />
          <div className="overflow-x-auto px-5 py-4">
            <table className="w-full text-sm">
              <caption className="sr-only">Coordination summary per care profile</caption>
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">Person</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Access</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Open tasks</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Appointments (30d)</th>
                  <th scope="col" className="py-2 text-right font-semibold">Documents</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">{row.name}</th>
                    <td className="py-2 pr-3">
                      <Badge tone={row.access === 'owner' ? 'accent' : 'neutral'}>{row.access}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.openTasks}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.appointments}</td>
                    <td className="py-2 text-right tabular-nums">{row.documents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <form method="get" action="/activity" className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Person" name="profile" className="min-w-56">
            <Select name="profile" defaultValue={sp.profile ?? ''}>
              <option value="">Everyone</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </Select>
          </Field>
          <button type="submit"
            className="cc-btn rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink">
            Apply
          </button>
        </form>
      </Card>

      <Card>
        <CardHead title="Family activity timeline"
                  sub="Filtered entry by entry: two people in the same circle correctly see different things here." />
        {activity.length === 0 ? (
          <EmptyState title="No activity yet"
            body="Adding documents, scheduling appointments and completing tasks all appear here." />
        ) : (
          <ol className="divide-y divide-line">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.95rem] text-ink">{a.summary}</p>
                  <p className="text-xs text-faint">
                    {a.profile_name} · {a.actor_name ?? 'Someone'} ·{' '}
                    {formatDateTime(a.occurred_at, settings.timezone, settings.locale)}
                  </p>
                </div>
                <Badge tone="neutral">{a.kind.replace(/_/g, ' ')}</Badge>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <CardHead title="Your security history"
                  sub="Events recorded against your account. Health content is never written to this log." />
        <Disclosure summary={`Show ${audit.length} recent event(s)`}>
          <ol className="divide-y divide-line">
            {audit.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Badge tone={e.outcome === 'denied' ? 'bad' : 'neutral'}>{e.outcome}</Badge>
                <span className="font-mono text-ink">{e.action}</span>
                {e.profile_name ? <span className="text-muted">{e.profile_name}</span> : null}
                <span className="ml-auto text-faint">{relative(e.occurred_at, settings.locale)}</span>
              </li>
            ))}
          </ol>
        </Disclosure>
      </Card>
    </div>
  );
}
