import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { listDocuments } from '@/lib/documents';
import { INSTRUCTION_SOURCES, SOURCE_LABELS } from '@/lib/medications';
import { createScheduleAction } from '@/app/actions/meds';
import { todayInZone } from '@/lib/time';
import {
  Card, CardHead, Checkbox, Field, Flash, Input, Notice, PageHead, Select, Textarea,
} from '@/components/ui';
import { SubmitButton, TimeList } from '@/components/client';

export const metadata = { title: 'Add a medication routine' };

const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'],
               ['6', 'Sat'], ['0', 'Sun']] as const;

export default async function NewMedicationPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; error?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;

  const profiles = accessibleProfiles(user.id)
    .filter((p) => p.access === 'owner' || p.scopes.includes('medications:manage'));
  const target = sp.profile && profiles.some((p) => p.id === sp.profile) ? sp.profile : profiles[0]?.id;
  const prescriptions = target
    ? listDocuments(user.id, { careProfileId: target, category: 'prescription', limit: 50 })
    : [];

  return (
    <div className="space-y-6">
      <Flash error={sp.error} />
      <PageHead title="Add a medication routine"
                sub="Copy the instruction exactly as it was given to you. CareCircle will not compose one." />

      <Notice tone="warn" title="Enter only what has actually been prescribed or confirmed">
        This form records an existing instruction so it can be reminded about. It is not a place to
        decide a dose. If you are unsure what the instruction is, stop and check with the
        prescribing clinician before saving anything.
      </Notice>

      {profiles.length === 0 ? (
        <Notice tone="warn" title="No profile you can add a routine to">
          You need a profile of your own, or the &ldquo;add and change medication schedules&rdquo;
          permission on someone else&rsquo;s.
        </Notice>
      ) : (
        <Card>
          <CardHead title="Routine details" />
          <form action={createScheduleAction} className="space-y-5 p-5">
            <Field label="Who is this for?" name="careProfileId" required>
              <Select name="careProfileId" required defaultValue={target}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}{p.access === 'granted' ? ' (shared with you)' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Medicine name" name="medicationName" required>
                <Input name="medicationName" required maxLength={160} autoFocus
                       placeholder="as written on the prescription" />
              </Field>
              <Field label="Strength" name="strength">
                <Input name="strength" maxLength={60} placeholder="e.g. 500 mg" />
              </Field>
              <Field label="Form" name="form">
                <Input name="form" maxLength={60} placeholder="e.g. tablet, syrup" />
              </Field>
            </div>

            <Field label="Dose instruction, word for word" name="doseInstruction" required
                   hint="Copy it verbatim — for example “1 tablet twice a day after food”. Do not paraphrase or convert it.">
              <Textarea name="doseInstruction" rows={2} required maxLength={400} />
            </Field>

            <Field label="Where does this instruction come from?" name="instructionSource" required>
              <Select name="instructionSource" required defaultValue="clinician_written">
                {INSTRUCTION_SOURCES.map((s) => (
                  <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
                ))}
              </Select>
            </Field>

            {prescriptions.length > 0 ? (
              <Field label="Attach the prescription" name="prescriptionDocumentId"
                     hint="Strongly recommended, so anyone can check the original.">
                <Select name="prescriptionDocumentId" defaultValue="">
                  <option value="">Not attached</option>
                  {prescriptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}{d.document_date ? ` — ${d.document_date}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Notice tone="neutral">
                No prescription documents are filed for this person yet. You can upload one in the
                Health Vault and attach it later.
              </Notice>
            )}

            <Field label="Reminder times" name="timesOfDay" required
                   hint="One slot is created per time, per day. Each slot has to be answered individually.">
              <TimeList name="timesOfDay" />
            </Field>

            <fieldset className="rounded-card border border-line bg-surface-2 p-4">
              <legend className="px-1 text-sm font-semibold text-ink">Which days?</legend>
              <p className="text-sm text-muted">Leave all unticked for every day.</p>
              <div className="mt-2 flex flex-wrap gap-x-5">
                {DAYS.map(([value, label]) => (
                  <Checkbox key={value} name="daysOfWeek" value={value} label={label} />
                ))}
              </div>
            </fieldset>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Start date" name="startDate" required>
                <Input name="startDate" type="date" required
                       defaultValue={todayInZone(settings.timezone)} />
              </Field>
              <Field label="End date" name="endDate" hint="If the course has one.">
                <Input name="endDate" type="date" />
              </Field>
              <Field label="Refill reminder" name="refillReminderDate" hint="Optional.">
                <Input name="refillReminderDate" type="date" />
              </Field>
            </div>
            <input type="hidden" name="timezone" value={settings.timezone} />

            <Field label="Notes" name="notes" hint="Practical notes only — where it is kept, which pharmacy.">
              <Textarea name="notes" rows={2} maxLength={1000} />
            </Field>

            <fieldset className="rounded-card border border-warn/40 bg-warn-soft p-4">
              <legend className="px-1 text-sm font-semibold text-warn">Required confirmation</legend>
              <Checkbox name="confirmed" required
                label="I confirm this instruction is exactly as prescribed, or exactly as the person taking it described it."
                hint="Without this, the routine will not save. CareCircle must never hold a dose that nobody stands behind." />
            </fieldset>

            <SubmitButton pendingLabel="Saving…">Save routine and schedule reminders</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
