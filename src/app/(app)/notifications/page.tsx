import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { notifications, snoozedNotifications, upcomingReminders } from '@/lib/reminders';
import { formatDateTime, relative } from '@/lib/time';
import {
  acknowledgeAction, dismissAction, markAllReadAction, markReadAction, runSchedulerAction,
  snoozeAction,
} from '@/app/actions/system';
import {
  Badge, Card, CardHead, EmptyState, Flash, Notice, PageHead,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string; show?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;
  const includeDismissed = sp.show === 'all';

  const items = notifications(user.id, { includeDismissed, limit: 80 });
  const snoozed = snoozedNotifications(user.id);
  const scheduled = upcomingReminders(user.id, 25);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Notifications"
                sub="In-app only. No SMS, email or push notification is sent by this build."
                action={
                  <div className="flex flex-wrap gap-2">
                    <form action={markAllReadAction}>
                      <SubmitButton variant="secondary">Mark all read</SubmitButton>
                    </form>
                    <form action={runSchedulerAction}>
                      <SubmitButton variant="secondary">Run scheduler now</SubmitButton>
                    </form>
                  </div>
                } />

      <Notice tone="neutral" title="What each state actually means">
        <ul className="mt-1 space-y-1">
          <li><strong className="text-ink">Scheduled</strong> — a reminder exists for a future time.</li>
          <li><strong className="text-ink">Generated</strong> — that time passed while the app was running, and a notification was created.</li>
          <li><strong className="text-ink">Delivered</strong> — it is in this list. That is the only delivery this build can evidence.</li>
          <li><strong className="text-ink">Acknowledged</strong> — you pressed the button. Nothing else sets it, and reading a notification is not the same as acting on it.</li>
        </ul>
      </Notice>

      <Card>
        <CardHead title="Your notifications"
                  sub={includeDismissed ? 'Including dismissed' : 'Dismissed items hidden'}
                  action={
                    <Link href={includeDismissed ? '/notifications' : '/notifications?show=all'}
                      className="text-sm font-semibold text-accent hover:underline">
                      {includeDismissed ? 'Hide dismissed' : 'Show dismissed'}
                    </Link>
                  } />
        {items.length === 0 ? (
          <EmptyState title="Nothing here yet"
            body="Reminders appear once their scheduled time has passed while the server is running. You can force a pass with “Run scheduler now”." />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    {!n.read_at ? (
                      <span aria-label="Unread" className="mr-1.5 text-accent">●</span>
                    ) : null}
                    {n.link ? (
                      <Link href={n.link} className="hover:text-accent">{n.title}</Link>
                    ) : n.title}
                  </p>
                  <p className="text-[0.95rem] text-muted">{n.body}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {n.profile_name ? `${n.profile_name} · ` : ''}
                    {formatDateTime(n.created_at, settings.timezone, settings.locale)}
                    {' · '}{relative(n.created_at, settings.locale)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {n.acknowledged_at ? <Badge tone="ok">Acknowledged</Badge>
                    : n.read_at ? <Badge tone="neutral">Read</Badge>
                    : <Badge tone="accent">Unread</Badge>}
                  {!n.acknowledged_at ? (
                    <form action={acknowledgeAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                        Acknowledge
                      </SubmitButton>
                    </form>
                  ) : null}
                  {!n.read_at ? (
                    <form action={markReadAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <SubmitButton variant="ghost" className="px-3 py-1.5 text-sm">
                        Mark read
                      </SubmitButton>
                    </form>
                  ) : null}
                  <form action={snoozeAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <input type="hidden" name="minutes" value="240" />
                    <SubmitButton variant="ghost" className="px-3 py-1.5 text-sm">
                      Snooze 4h
                    </SubmitButton>
                  </form>
                  <form action={dismissAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <SubmitButton variant="ghost" className="px-3 py-1.5 text-sm">
                      Dismiss
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {snoozed.length > 0 ? (
        <Card>
          <CardHead title="Snoozed" sub="These come back on their own." />
          <ul className="divide-y divide-line">
            {snoozed.map((n) => (
              <li key={n.id} className="px-5 py-3">
                <p className="font-medium text-ink">{n.title}</p>
                <p className="text-sm text-muted">
                  Returns {n.snoozed_until ? relative(n.snoozed_until, settings.locale) : 'soon'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Scheduled reminders"
                  sub="Not yet generated. These will produce notifications when their time passes." />
        {scheduled.length === 0 ? (
          <EmptyState title="Nothing scheduled"
            body="Appointments, care tasks with a due date, and medication routines create reminders automatically." />
        ) : (
          <ul className="divide-y divide-line">
            {scheduled.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="w-44 shrink-0 font-mono text-sm text-muted">
                  {formatDateTime(r.due_at, settings.timezone, settings.locale)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.95rem] text-ink">
                    {r.subject_type.replace(/_/g, ' ')} — {r.profile_name}
                  </p>
                </div>
                <Badge tone="neutral">{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Notice tone="warn" title="Do not rely on this as a safety net">
        Reminders are generated only while the application is running, and they appear only inside
        the app. CareCircle is not an alerting or monitoring service, and it will never summon
        help. For anything clinically important, use something designed for that purpose.
      </Notice>
    </div>
  );
}
