import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { TASK_STATUS_LABELS, TASK_STATUSES, listTasks, pendingHandoversFor } from '@/lib/tasks';
import { upcomingAppointments } from '@/lib/appointments';
import { caregiverLoad, coordinationMetrics, weeklyTaskTrend } from '@/lib/analytics';
import { formatDateTime, relative } from '@/lib/time';
import {
  Badge, ButtonLink, Card, CardHead, Disclosure, EmptyState, Field, Flash, PageHead, Select, Stat,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';
import { setTaskStatusAction } from '@/app/actions/planner';
import type { TaskStatus } from '@/lib/tasks';

export const metadata = { title: 'Care planner' };

export default async function PlannerPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; status?: string; mine?: string; error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;
  const profiles = accessibleProfiles(user.id);

  const tasks = listTasks(user.id, {
    careProfileId: sp.profile || null,
    status: (sp.status as TaskStatus) || null,
    assigneeUserId: sp.mine === '1' ? user.id : null,
    limit: 200,
  });
  const handovers = pendingHandoversFor(user.id);
  const metrics = coordinationMetrics(user.id);
  const load = caregiverLoad(user.id);
  const trend = weeklyTaskTrend(user.id, 12);
  const soon = upcomingAppointments(user.id, 14, 50);
  const now = new Date().toISOString();

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Care planner"
                sub="Shared tasks and the week ahead. Nothing is complete until a person says so."
                action={<ButtonLink href="/planner/new">Create a care task</ButtonLink>} />

      {handovers.length > 0 ? (
        <Card className="border-warn/40">
          <CardHead title="Handover requests waiting for you" />
          <ul className="divide-y divide-line">
            {handovers.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{h.task_title}</p>
                  <p className="text-sm text-muted">
                    From {h.from_name} · asked {relative(h.requested_at, settings.locale)} ·
                    expires {relative(h.expires_at, settings.locale)}
                  </p>
                </div>
                <ButtonLink href={`/tasks/${h.task_id}`} variant="secondary"
                            className="px-3 py-1.5 text-sm">Review</ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section>
        <h2 className="sr-only">Coordination metrics</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.slice(0, 6).map((m) => (
            <Stat key={m.key} label={m.label} value={m.value} tone={m.tone}
                  definition={m.definition} href={m.link} />
          ))}
        </div>
        <Disclosure summary="How these numbers are calculated" >
          <dl className="space-y-2">
            {metrics.map((m) => (
              <div key={m.key}>
                <dt className="font-semibold text-ink">{m.label}</dt>
                <dd>{m.definition}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-ink">
            These measure coordination, not health. There are deliberately no risk scores,
            severity ratings, predictions or adherence grades anywhere in CareCircle.
          </p>
        </Disclosure>
      </section>

      <Card>
        <form method="get" action="/planner" className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Person" name="profile">
            <Select name="profile" defaultValue={sp.profile ?? ''}>
              <option value="">Everyone</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </Select>
          </Field>
          <Field label="Status" name="status">
            <Select name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Assigned to" name="mine">
            <Select name="mine" defaultValue={sp.mine ?? ''}>
              <option value="">Anyone</option>
              <option value="1">Only me</option>
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <button type="submit"
              className="cc-btn rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink">
              Apply
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHead title="Care tasks" sub={`${tasks.length} shown`} />
        {tasks.length === 0 ? (
          <EmptyState title="No tasks match"
            body="Care tasks are the administrative jobs around someone's care — booking, collecting, chasing, arranging transport."
            action={<ButtonLink href="/planner/new">Create a care task</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((t) => {
              const overdue = t.due_at && t.due_at < now
                && ['pending', 'accepted', 'in_progress'].includes(t.status);
              return (
                <li key={t.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/tasks/${t.id}`} className="font-semibold text-ink hover:text-accent">
                      {t.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {t.profile_name} · {t.assignee_name ?? 'nobody assigned'}
                      {t.due_at ? ` · due ${formatDateTime(t.due_at, settings.timezone, settings.locale)}` : ''}
                    </p>
                    {t.appointment_title ? (
                      <p className="text-sm text-faint">For: {t.appointment_title}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {t.priority === 'high' ? <Badge tone="bad">High</Badge> : null}
                    {overdue ? <Badge tone="warn">Overdue</Badge> : null}
                    <Badge tone={taskTone(t.status)}>{TASK_STATUS_LABELS[t.status]}</Badge>
                    {t.assignee_user_id === user.id && t.status === 'pending' ? (
                      <form action={setTaskStatusAction}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="status" value="accepted" />
                        <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                          Accept
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHead title="Shared care calendar" sub="Appointments in the next fortnight." />
          {soon.length === 0 ? <EmptyState title="Nothing scheduled" /> : (
            <ul className="divide-y divide-line">
              {soon.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="w-40 shrink-0 font-mono text-sm text-muted">
                    {formatDateTime(a.starts_at, settings.timezone, settings.locale)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/appointments/${a.id}`} className="font-medium text-ink hover:text-accent">
                      {a.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {a.profile_name} · {a.responsible_name ?? 'nobody assigned'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Who is carrying what"
                    sub="Open and overdue tasks per person, plus what they finished in the last 30 days." />
          {load.length === 0 ? <EmptyState title="No tasks to balance yet" /> : (
            <div className="overflow-x-auto px-5 py-4">
              <table className="w-full text-sm">
                <caption className="sr-only">Task load per caregiver</caption>
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th scope="col" className="py-2 pr-3 font-semibold">Person</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Open</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Overdue</th>
                    <th scope="col" className="py-2 text-right font-semibold">Done (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {load.map((row) => (
                    <tr key={row.name} className="border-b border-line last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">{row.name}</th>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.open}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.overdue ? 'font-bold text-warn' : ''}`}>
                        {row.overdue}
                      </td>
                      <td className="py-2 text-right tabular-nums text-ok">{row.completed30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHead title="Task throughput" sub="Created and completed per week, last 12 weeks." />
        <div className="p-5">
          <TrendChart points={trend} />
        </div>
      </Card>
    </div>
  );
}

/**
 * Inline SVG bars.
 * ponytail: a charting library for two series of twelve integers is not worth
 * ~500 KB and a client bundle. Swap in a real chart library if the analytics
 * page grows interactive tooltips or zooming.
 */
function TrendChart({ points }: { points: { weekStart: string; created: number; completed: number }[] }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.created, p.completed]));
  const w = 100 / points.length;
  return (
    <figure>
      <svg viewBox="0 0 100 40" className="h-40 w-full" role="img"
           aria-label={`Weekly task throughput. ${points.map((p) => `Week of ${p.weekStart}: ${p.created} created, ${p.completed} completed`).join('. ')}`}>
        {points.map((p, i) => (
          <g key={p.weekStart}>
            <rect x={i * w + w * 0.14} y={36 - (p.created / max) * 32}
                  width={w * 0.33} height={Math.max(0.4, (p.created / max) * 32)}
                  fill="var(--accent)" rx="0.6" />
            <rect x={i * w + w * 0.53} y={36 - (p.completed / max) * 32}
                  width={w * 0.33} height={Math.max(0.4, (p.completed / max) * 32)}
                  fill="var(--success)" rx="0.6" />
          </g>
        ))}
        <line x1="0" y1="36" x2="100" y2="36" stroke="var(--border)" strokeWidth="0.3" />
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-accent" />Created
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-ok" />Completed
        </span>
        <span>Peak {max} in a week</span>
      </figcaption>
    </figure>
  );
}

function taskTone(status: TaskStatus): 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' {
  switch (status) {
    case 'completed': return 'ok';
    case 'cancelled': return 'neutral';
    case 'unable_to_complete': return 'bad';
    case 'in_progress': return 'accent';
    case 'accepted': return 'accent';
    default: return 'warn';
  }
}
