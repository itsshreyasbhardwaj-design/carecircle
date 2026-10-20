import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { upcomingAppointments } from '@/lib/appointments';
import { listTasks, pendingHandoversFor } from '@/lib/tasks';
import { checkinsInWindow, unconfirmedCheckins } from '@/lib/medications';
import { listDocuments, CATEGORY_LABELS } from '@/lib/documents';
import { notifications } from '@/lib/reminders';
import { circlesFor } from '@/lib/circles';
import { formatDateTime, formatTime, relative, todayInZone } from '@/lib/time';
import {
  Badge, ButtonLink, Card, CardHead, DemoBanner, EmptyState, Flash, PageHead, SafetyNote, Stat,
} from '@/components/ui';
import { recordCheckinAction } from '@/app/actions/meds';
import { setTaskStatusAction } from '@/app/actions/planner';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Today' };

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string; profile?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const { error, ok, profile: profileFilter } = await searchParams;
  const tz = settings.timezone;
  const locale = settings.locale;

  const profiles = accessibleProfiles(user.id);
  const selected = profileFilter && profiles.some((p) => p.id === profileFilter)
    ? profileFilter : null;

  const appts = upcomingAppointments(user.id, 7, 25)
    .filter((a) => !selected || a.care_profile_id === selected);
  const openTasks = listTasks(user.id, { openOnly: true, careProfileId: selected, limit: 50 });
  const unconfirmed = unconfirmedCheckins(user.id, 50)
    .filter((c) => !selected || c.care_profile_id === selected);
  const recentDocs = listDocuments(user.id, { careProfileId: selected, limit: 5 });
  const notes = notifications(user.id, { limit: 5 });
  const handovers = pendingHandoversFor(user.id);
  const circles = circlesFor(user.id);
  const isDemo = profiles.some((p) => p.is_demo === 1);

  // Today's plan: appointments and dose slots for the local day, in time order.
  const today = todayInZone(tz);
  const dayStart = `${today}T00:00:00.000Z`;
  const dayEnd = `${today}T23:59:59.999Z`;
  const todaysDoses = checkinsInWindow(user.id, dayStart, dayEnd, selected)
    .filter((c) => c.status === 'not_confirmed' || c.status === 'snoozed');
  const todaysAppts = appts.filter((a) => a.starts_at.slice(0, 10) === today);
  const plan = [
    ...todaysAppts.map((a) => ({
      at: a.starts_at, kind: 'appointment' as const, title: a.title,
      who: a.responsible_name, profile: a.profile_name, href: `/appointments/${a.id}`,
      node: null as React.ReactNode,
    })),
    ...todaysDoses.map((c) => ({
      at: c.scheduled_for, kind: 'dose' as const,
      title: `${c.medication_name}`, who: null, profile: c.profile_name, href: '/medications',
      node: (
        <form action={recordCheckinAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="scheduleId" value={c.schedule_id} />
          <input type="hidden" name="scheduledFor" value={c.scheduled_for} />
          <input type="hidden" name="back" value="/dashboard" />
          <input type="hidden" name="status" value="taken" />
          <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
            Mark taken
          </SubmitButton>
        </form>
      ),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="space-y-6">
      <Flash error={error} ok={ok} />
      {isDemo ? <DemoBanner /> : null}

      <PageHead
        title={`${greeting()}, ${user.full_name.split(' ')[0]}`}
        sub={`${formatDateTime(new Date().toISOString(), tz, locale)} · ${tz}`}
      />

      {profiles.length > 1 || circles.length > 0 ? (
        <Card className="p-4">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">Showing</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <FilterChip href="/dashboard" active={!selected} label="Everyone" />
              {profiles.map((p) => (
                <FilterChip key={p.id} href={`/dashboard?profile=${p.id}`}
                  active={selected === p.id}
                  label={`${p.display_name}${p.access === 'granted' ? ' (shared)' : ''}`} />
              ))}
            </div>
            {circles.length > 0 ? (
              <p className="mt-3 text-sm text-muted">
                Circles:{' '}
                {circles.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 ? ', ' : ''}
                    <Link href={`/family/${c.id}`} className="font-medium text-accent hover:underline">
                      {c.name}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </fieldset>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Appointments this week" value={appts.length} href="/appointments"
              definition="Not cancelled, starting within 7 days." />
        <Stat label="Open care tasks" value={openTasks.length} href="/planner"
              tone={openTasks.some((t) => t.due_at && t.due_at < new Date().toISOString()) ? 'attention' : 'neutral'}
              definition="Pending, accepted or in progress." />
        <Stat label="Dose slots unanswered" value={unconfirmed.length} href="/medications"
              tone={unconfirmed.length ? 'attention' : 'good'}
              definition="Past reminder slots nobody has confirmed. Not a count of missed doses." />
        <Stat label="Documents added recently" value={recentDocs.length} href="/records"
              definition="The five most recent documents you can read." />
      </div>

      {handovers.length > 0 ? (
        <Card className="border-warn/40">
          <CardHead title="Waiting for your answer"
                    sub="Someone has asked you to take over a care task." />
          <ul className="divide-y divide-line">
            {handovers.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{h.task_title}</p>
                  <p className="text-sm text-muted">
                    {h.from_name} asked {relative(h.requested_at, locale)}
                    {h.reason ? ` — “${h.reason}”` : ''}
                  </p>
                </div>
                <ButtonLink href={`/tasks/${h.task_id}`} variant="secondary"
                            className="px-3 py-1.5 text-sm">
                  Review
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Today's care plan"
                  sub="Appointments and medication times for today, in order." />
        {plan.length === 0 ? (
          <EmptyState title="Nothing scheduled today"
            body="When you add an appointment or a medication routine, today's items appear here."
            action={<ButtonLink href="/appointments/new" variant="secondary">Schedule an appointment</ButtonLink>} />
        ) : (
          <ol className="divide-y divide-line">
            {plan.map((item, i) => (
              <li key={`${item.kind}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <span className="w-20 shrink-0 font-mono text-sm text-muted">
                  {formatTime(item.at, tz, locale)}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={item.href} className="font-medium text-ink hover:text-accent">
                    {item.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {item.profile}
                    {item.kind === 'appointment'
                      ? ` · ${item.who ?? 'nobody assigned'}`
                      : ' · awaiting confirmation'}
                  </p>
                </div>
                <Badge tone={item.kind === 'appointment' ? 'accent' : 'warn'}>
                  {item.kind === 'appointment' ? 'Appointment' : 'Medication'}
                </Badge>
                {item.node}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHead title="Family responsibilities"
                    sub="Who is handling what, and what nobody has yet."
                    action={<ButtonLink href="/planner" variant="ghost" className="px-3 py-1.5 text-sm">All tasks</ButtonLink>} />
          {openTasks.length === 0 ? (
            <EmptyState title="No open tasks"
              action={<ButtonLink href="/planner/new" variant="secondary">Create a care task</ButtonLink>} />
          ) : (
            <ul className="divide-y divide-line">
              {openTasks.slice(0, 7).map((t) => {
                const overdue = t.due_at && t.due_at < new Date().toISOString();
                const mine = t.assignee_user_id === user.id;
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/tasks/${t.id}`} className="font-medium text-ink hover:text-accent">
                        {t.title}
                      </Link>
                      <p className="text-sm text-muted">
                        {t.profile_name} · {t.assignee_name ?? 'nobody assigned'}
                        {t.due_at ? ` · due ${relative(t.due_at, locale)}` : ''}
                      </p>
                    </div>
                    {overdue ? <Badge tone="warn">Overdue</Badge> : null}
                    {t.priority === 'high' ? <Badge tone="bad">High</Badge> : null}
                    {mine && t.status === 'pending' ? (
                      <form action={setTaskStatusAction}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="status" value="accepted" />
                        <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                          Accept
                        </SubmitButton>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Upcoming appointments" sub="The next seven days."
                    action={<ButtonLink href="/appointments" variant="ghost" className="px-3 py-1.5 text-sm">All</ButtonLink>} />
          {appts.length === 0 ? (
            <EmptyState title="Nothing in the next week" />
          ) : (
            <ul className="divide-y divide-line">
              {appts.slice(0, 6).map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <Link href={`/appointments/${a.id}`} className="font-medium text-ink hover:text-accent">
                    {a.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {a.profile_name} · {formatDateTime(a.starts_at, tz, locale)}
                  </p>
                  <p className="text-sm text-muted">
                    {a.responsible_name ? `${a.responsible_name} is taking them` : 'Nobody assigned yet'}
                    {a.prep_total > 0 ? ` · ${a.prep_done}/${a.prep_total} preparation items done` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Health Vault activity" sub="Only documents you have access to."
                    action={<ButtonLink href="/records" variant="ghost" className="px-3 py-1.5 text-sm">All</ButtonLink>} />
          {recentDocs.length === 0 ? (
            <EmptyState title="No documents yet"
              body="Upload a prescription or a report and CareCircle will help you file it."
              action={<ButtonLink href="/records/new" variant="secondary">Add a document</ButtonLink>} />
          ) : (
            <ul className="divide-y divide-line">
              {recentDocs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/records/${d.id}`} className="font-medium text-ink hover:text-accent">
                      {d.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {d.profile_name} · {CATEGORY_LABELS[d.category]}
                      {d.document_date ? ` · ${d.document_date}` : ''}
                    </p>
                  </div>
                  {d.sensitivity === 'restricted' ? <Badge tone="bad">Restricted</Badge> : null}
                  {!d.extraction_reviewed ? <Badge tone="warn">Needs review</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Important reminders" sub="Generated notifications, newest first."
                    action={<ButtonLink href="/notifications" variant="ghost" className="px-3 py-1.5 text-sm">All</ButtonLink>} />
          {notes.length === 0 ? (
            <EmptyState title="No notifications"
              body="Reminders appear here once a scheduled time passes while the app is running." />
          ) : (
            <ul className="divide-y divide-line">
              {notes.map((n) => (
                <li key={n.id} className="px-5 py-3">
                  <p className="font-medium text-ink">
                    {n.read_at ? null : <span aria-label="Unread" className="mr-1.5 text-accent">●</span>}
                    {n.title}
                  </p>
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="text-xs text-faint">{relative(n.created_at, locale)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHead title="Quick actions" />
        <div className="flex flex-wrap gap-3 p-5">
          <ButtonLink href="/records/new" variant="secondary">Add a document</ButtonLink>
          <ButtonLink href="/appointments/new" variant="secondary">Schedule an appointment</ButtonLink>
          <ButtonLink href="/planner/new" variant="secondary">Create a care task</ButtonLink>
          <ButtonLink href="/medications/new" variant="secondary">Add a medication routine</ButtonLink>
          <ButtonLink href="/family" variant="secondary">Invite a caregiver</ButtonLink>
        </div>
      </Card>

      <SafetyNote />
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-current={active ? 'true' : undefined}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${
        active ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-surface text-ink'}`}>
      {label}
    </Link>
  );
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })
      .format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
