import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { LOCALE_NAMES } from '@/lib/i18n';
import { signOutAction } from '@/app/actions/auth';
import { devSetPlanAction, updateSettingsAction } from '@/app/actions/system';
import {
  Badge, Card, CardHead, Checkbox, Field, Flash, Notice, PageHead, Select,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Settings' };

const ZONES = ['Asia/Kolkata', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Dubai', 'Asia/Singapore',
                'Europe/London', 'America/New_York', 'Australia/Sydney', 'UTC'];

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Settings" sub={`${user.full_name} · ${user.email}`} />

      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {([['/settings', 'General'], ['/settings/access', 'Access'],
           ['/settings/privacy', 'Privacy and data'], ['/settings/security', 'Security']] as const).map(
          ([href, label]) => (
            <Link key={href} href={href}
              className="cc-btn inline-flex items-center rounded-card border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-2">
              {label}
            </Link>
          ))}
      </nav>

      {/* The sidebar sign-out is desktop-only, so this is the one that works at
          every width. On a shared phone, being unable to sign out of a health
          app is a privacy problem, not a cosmetic one. */}
      <Card>
        <CardHead title="Account" sub={`Signed in as ${user.email}`} />
        <div className="flex flex-wrap items-center gap-3 p-5">
          <form action={signOutAction}>
            <SubmitButton variant="secondary" pendingLabel="Signing out…">Sign out</SubmitButton>
          </form>
          <p className="text-sm text-muted">
            Signing out ends this session on this device only. To end others, use
            Security.
          </p>
        </div>
      </Card>

      <Card>
        <CardHead title="How CareCircle looks and behaves" />
        <form action={updateSettingsAction} className="space-y-5 p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Language" name="locale"
                   hint="Navigation and common messages. Clinical text is always shown in the words it was entered in.">
              <Select name="locale" defaultValue={settings.locale}>
                {Object.entries(LOCALE_NAMES).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Time zone" name="timezone"
                   hint="Appointment and dose times are shown in this zone.">
              <Select name="timezone" defaultValue={settings.timezone}>
                {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Appearance" name="theme">
            <Select name="theme" defaultValue={settings.theme}>
              <option value="system">Follow my device</option>
              <option value="light">Always light</option>
              <option value="dark">Always dark</option>
            </Select>
          </Field>

          <fieldset className="rounded-card border border-line bg-surface-2 p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Easier reading</legend>
            <Checkbox name="largeText" label="Larger text throughout"
                      defaultChecked={settings.large_text === 1}
                      hint="Increases the base size everywhere, not just headings." />
            <Checkbox name="reduceMotion" label="Reduce animation"
                      defaultChecked={settings.reduce_motion === 1}
                      hint="Also honoured automatically if your device asks for reduced motion." />
          </fieldset>

          <Field label="Remind me this long before something is due" name="reminderLeadMinutes">
            <Select name="reminderLeadMinutes" defaultValue={String(settings.reminder_lead_minutes)}>
              {[['0', 'At the time it is due'], ['30', '30 minutes before'],
                ['60', '1 hour before'], ['120', '2 hours before'],
                ['360', '6 hours before'], ['1440', '1 day before'],
                ['2880', '2 days before']].map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>

          <fieldset className="rounded-card border border-line bg-surface-2 p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Which reminders to generate</legend>
            <Checkbox name="notifyAppointments" label="Appointments"
                      defaultChecked={settings.notify_appointments === 1} />
            <Checkbox name="notifyMedications" label="Medication dose times"
                      defaultChecked={settings.notify_medications === 1} />
            <Checkbox name="notifyTasks" label="Care tasks with a due date"
                      defaultChecked={settings.notify_tasks === 1} />
            <Checkbox name="caregiverFollowups"
                      label="Also notify me about dose slots nobody has confirmed"
                      defaultChecked={settings.caregiver_followups === 1}
                      hint="For caregivers who are explicitly authorised to see check-ins." />
          </fieldset>

          <Notice tone="neutral">
            Reminders are generated while the app is running and appear in the notification centre.
            There is no SMS, email or push delivery in this build, so none is offered here.
          </Notice>

          <SubmitButton>Save settings</SubmitButton>
        </form>
      </Card>

      <Card>
        <CardHead title="Your plan"
                  sub="Billing is not implemented. No payment provider is connected."
                  action={<Badge tone={settings.plan === 'family' ? 'accent' : 'neutral'}>
                    {settings.plan === 'family' ? 'Family (not a real subscription)' : 'Free'}
                  </Badge>} />
        <div className="space-y-4 p-5">
          <p className="text-muted">
            Every feature is available to every account in this build, so the product can be
            evaluated honestly. The entitlement field exists so a future release has somewhere to
            record a subscription — it does not gate anything today.
          </p>
          {settings.plan_source === 'dev_override' ? (
            <Notice tone="warn" title="Developer override active">
              This plan value was set by a developer tool, not by a purchase.
            </Notice>
          ) : null}
          {isDev ? (
            <form action={devSetPlanAction} className="flex flex-wrap items-end gap-3">
              <Field label="Developer plan override" name="plan" className="min-w-48"
                     hint="Development builds only. Refused in production.">
                <Select name="plan" defaultValue={settings.plan}>
                  <option value="free">Free</option>
                  <option value="family">Family</option>
                </Select>
              </Field>
              <SubmitButton variant="secondary">Apply override</SubmitButton>
            </form>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
