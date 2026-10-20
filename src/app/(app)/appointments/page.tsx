import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { APPOINTMENT_STATUSES, STATUS_LABELS, listAppointments } from '@/lib/appointments';
import { formatDateTime, relative } from '@/lib/time';
import {
  Badge, ButtonLink, Card, CardHead, EmptyState, Field, Flash, PageHead, Select,
} from '@/components/ui';
import type { AppointmentStatus } from '@/lib/appointments';

export const metadata = { title: 'Appointments' };

export default async function AppointmentsPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; status?: string; when?: string; error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;
  const profiles = accessibleProfiles(user.id);
  const now = new Date().toISOString();
  const when = sp.when === 'past' ? 'past' : 'upcoming';

  const all = listAppointments(user.id, {
    careProfileId: sp.profile || null,
    status: (sp.status as AppointmentStatus) || null,
    limit: 300,
  });
  const rows = when === 'past'
    ? all.filter((a) => a.starts_at < now).reverse()
    : all.filter((a) => a.starts_at >= now);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Appointments"
                sub="Every appointment has a person responsible for it, or is visibly unassigned."
                action={<ButtonLink href="/appointments/new">Schedule an appointment</ButtonLink>} />

      <Card>
        <form method="get" action="/appointments" className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Person" name="profile">
            <Select name="profile" defaultValue={sp.profile ?? ''}>
              <option value="">Everyone</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </Select>
          </Field>
          <Field label="Status" name="status">
            <Select name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="When" name="when">
            <Select name="when" defaultValue={when}>
              <option value="upcoming">Upcoming</option>
              <option value="past">Past</option>
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
        <CardHead title={when === 'past' ? 'Past appointments' : 'Upcoming appointments'}
                  sub={`${rows.length} shown`} />
        {rows.length === 0 ? (
          <EmptyState
            title={when === 'past' ? 'No past appointments' : 'Nothing scheduled'}
            body="Add the next visit so the whole family can see who is taking them."
            action={<ButtonLink href="/appointments/new">Schedule an appointment</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4">
                <div className="w-44 shrink-0">
                  <p className="font-mono text-sm text-ink">
                    {formatDateTime(a.starts_at, settings.timezone, settings.locale)}
                  </p>
                  <p className="text-xs text-faint">{relative(a.starts_at, settings.locale)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/appointments/${a.id}`}
                        className="font-semibold text-ink hover:text-accent">
                    {a.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {a.profile_name}
                    {a.provider_name ? ` · ${a.provider_name}` : ''}
                    {a.location ? ` · ${a.location}` : ''}
                  </p>
                  <p className="text-sm text-muted">
                    {a.responsible_name
                      ? `${a.responsible_name} is responsible`
                      : 'Nobody is responsible yet'}
                    {a.prep_total > 0 ? ` · ${a.prep_done}/${a.prep_total} preparation items done` : ''}
                    {a.document_count > 0 ? ` · ${a.document_count} document(s) attached` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Badge tone={statusTone(a.status)}>{STATUS_LABELS[a.status]}</Badge>
                  {!a.responsible_user_id && a.status !== 'cancelled' && a.status !== 'completed'
                    ? <Badge tone="warn">Unassigned</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function statusTone(status: AppointmentStatus): 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' {
  switch (status) {
    case 'confirmed': return 'ok';
    case 'completed': return 'neutral';
    case 'cancelled': return 'bad';
    case 'rescheduled': return 'warn';
    case 'proposed': return 'warn';
    default: return 'accent';
  }
}
