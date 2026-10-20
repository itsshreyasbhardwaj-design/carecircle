import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { circlesFor, members } from '@/lib/circles';
import { can } from '@/lib/authz';
import { APPOINTMENT_STATUSES, STATUS_LABELS } from '@/lib/appointments';
import { createAppointmentAction } from '@/app/actions/planner';
import { todayInZone } from '@/lib/time';
import {
  Card, CardHead, Field, Flash, Input, Notice, PageHead, Select, Textarea,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Schedule an appointment' };

export default async function NewAppointmentPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; error?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;

  const profiles = accessibleProfiles(user.id)
    .filter((p) => p.access === 'owner' || p.scopes.includes('appointments:manage'));
  const target = sp.profile && profiles.some((p) => p.id === sp.profile)
    ? sp.profile : profiles[0]?.id;

  // Only people who can already see this profile's appointments may be assigned.
  const circleUsers = new Map<string, string>();
  for (const circle of circlesFor(user.id)) {
    for (const m of members(circle.id)) {
      if (target && can(m.user_id, 'appointments:view', target)) {
        circleUsers.set(m.user_id, m.full_name);
      }
    }
  }
  circleUsers.set(user.id, `${user.full_name} (you)`);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} />
      <PageHead title="Schedule an appointment"
                sub="Times are stored in UTC and shown in the time zone you choose, so travel and daylight changes do not shift them." />

      {profiles.length === 0 ? (
        <Notice tone="warn" title="No profile you can schedule for">
          You need either a profile of your own or the &ldquo;add and change appointments&rdquo;
          permission on someone else&rsquo;s.
        </Notice>
      ) : (
        <Card>
          <CardHead title="Appointment details" />
          <form action={createAppointmentAction} className="space-y-5 p-5">
            <Field label="Who is this appointment for?" name="careProfileId" required>
              <Select name="careProfileId" required defaultValue={target}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}{p.access === 'granted' ? ' (shared with you)' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="What is it?" name="title" required>
              <Input name="title" required maxLength={160} autoFocus
                     placeholder="e.g. Cardiology review" />
            </Field>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Date" name="date" required>
                <Input name="date" type="date" required
                       defaultValue={todayInZone(settings.timezone)} />
              </Field>
              <Field label="Time" name="time" required>
                <Input name="time" type="time" required defaultValue="09:30" />
              </Field>
              <Field label="Time zone" name="timezone" required>
                <Select name="timezone" required defaultValue={settings.timezone}>
                  {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London',
                    'America/New_York', 'UTC'].map((z) => <option key={z} value={z}>{z}</option>)}
                </Select>
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Doctor or clinic" name="providerName">
                <Input name="providerName" maxLength={160} placeholder="e.g. Dr. R. Nair" />
              </Field>
              <Field label="Location" name="location">
                <Input name="location" maxLength={200} placeholder="e.g. City Heart Clinic, Lajpat Nagar" />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="How long, in minutes" name="durationMinutes">
                <Input name="durationMinutes" type="number" min={5} max={600} step={5} />
              </Field>
              <Field label="Status" name="status">
                <Select name="status" defaultValue="scheduled">
                  {APPOINTMENT_STATUSES.filter((s) => s !== 'rescheduled').map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Who is taking them?" name="responsibleUserId"
                   hint="Only people who can already see this profile's appointments are listed. Sharing access is a separate, deliberate step.">
              <Select name="responsibleUserId" defaultValue="">
                <option value="">Nobody yet</option>
                {[...circleUsers.entries()].map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Notes" name="notes"
                   hint="Anything the family should know. Do not record clinical instructions you have not been given.">
              <Textarea name="notes" rows={3} maxLength={2000} />
            </Field>

            <Field label="Follow-up date" name="followupDate"
                   hint="Only if a clinician has actually specified one.">
              <Input name="followupDate" type="date" />
            </Field>

            <SubmitButton pendingLabel="Saving…">Schedule appointment</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
