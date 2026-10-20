import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import {
  CHECKIN_LABELS, SOURCE_LABELS, checkinTally, checkinsInWindow, listSchedules,
  unconfirmedCheckins,
} from '@/lib/medications';
import { can } from '@/lib/authz';
import { formatDate, formatDateTime, formatTime, relative, todayInZone } from '@/lib/time';
import { discontinueScheduleAction, recordCheckinAction } from '@/app/actions/meds';
import {
  Badge, ButtonLink, Card, CardHead, DefinitionRow, Disclosure, EmptyState, Field, Flash, Input,
  Notice, PageHead, SafetyNote, Select,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/client';

export const metadata = { title: 'Medications' };

export default async function MedicationsPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; show?: string; error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;
  const tz = settings.timezone;

  const includeDiscontinued = sp.show === 'all';
  const schedules = listSchedules(user.id, {
    careProfileId: sp.profile || null, includeDiscontinued,
  });
  const today = todayInZone(tz);
  const todaySlots = checkinsInWindow(
    user.id, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`, sp.profile || null,
  );
  const unconfirmed = unconfirmedCheckins(user.id, 30);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Medication routines"
                sub="Instructions exactly as a person confirmed them, with reminder times built from them."
                action={<ButtonLink href="/medications/new">Add a routine</ButtonLink>} />

      <Notice tone="neutral" title="What this module does and does not do">
        CareCircle stores and reminds. It never proposes a medicine, a dose or a frequency, never
        changes one, never advises what to do about a missed dose, and never checks interactions.
        Every routine records who confirmed the instruction. If an instruction is unclear, ask the
        prescribing clinician — not this app.
      </Notice>

      {unconfirmed.length > 0 ? (
        <Card className="border-warn/40">
          <CardHead title={`${unconfirmed.length} dose slot${unconfirmed.length === 1 ? '' : 's'} nobody has answered`}
                    sub="An unanswered reminder is an open question. It does not mean the medicine was missed." />
          <ul className="divide-y divide-line">
            {unconfirmed.slice(0, 10).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{c.medication_name}</p>
                  <p className="text-sm text-muted">
                    {c.profile_name} · slot {formatDateTime(c.scheduled_for, tz, settings.locale)}
                    {' '}({relative(c.scheduled_for, settings.locale)})
                  </p>
                  <p className="text-sm text-faint">As recorded: &ldquo;{c.dose_instruction}&rdquo;</p>
                </div>
                {can(user.id, 'medications:manage', c.care_profile_id) ? (
                  <div className="flex flex-wrap gap-2">
                    <CheckinButton scheduleId={c.schedule_id} slot={c.scheduled_for}
                                   status="taken" label="Taken" />
                    <CheckinButton scheduleId={c.schedule_id} slot={c.scheduled_for}
                                   status="skipped" label="Skipped" />
                  </div>
                ) : <Badge tone="neutral">View only</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Today's doses"
                  sub={`${formatDate(today, tz, settings.locale)} · ${tz}`} />
        {todaySlots.length === 0 ? (
          <EmptyState title="No dose slots today"
            body="Reminder times on an active routine create a slot for each dose." />
        ) : (
          <ol className="divide-y divide-line">
            {todaySlots.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="w-20 shrink-0 font-mono text-sm text-muted">
                  {formatTime(c.scheduled_for, tz, settings.locale)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{c.medication_name}</p>
                  <p className="text-sm text-muted">{c.profile_name}</p>
                </div>
                <Badge tone={c.status === 'taken' ? 'ok' : c.status === 'skipped' ? 'warn'
                  : c.status === 'snoozed' ? 'neutral' : 'warn'}>
                  {CHECKIN_LABELS[c.status]}
                </Badge>
                {c.reported_by_name ? (
                  <span className="text-xs text-faint">
                    reported by {c.reported_by_name}
                  </span>
                ) : null}
                {c.status === 'not_confirmed' && can(user.id, 'medications:manage', c.care_profile_id) ? (
                  <div className="flex flex-wrap gap-2">
                    <CheckinButton scheduleId={c.schedule_id} slot={c.scheduled_for}
                                   status="taken" label="Taken" />
                    <CheckinButton scheduleId={c.schedule_id} slot={c.scheduled_for}
                                   status="skipped" label="Skipped" />
                    <CheckinButton scheduleId={c.schedule_id} slot={c.scheduled_for}
                                   status="snoozed" label="Snooze" />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <form method="get" action="/medications" className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Show" name="show" className="min-w-48">
            <Select name="show" defaultValue={sp.show ?? 'active'}>
              <option value="active">Active routines</option>
              <option value="all">Include discontinued</option>
            </Select>
          </Field>
          <button type="submit"
            className="cc-btn rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink">
            Apply
          </button>
        </form>
      </Card>

      {schedules.length === 0 ? (
        <Card>
          <EmptyState title="No medication routines yet"
            body="Add one only when you have the instruction in front of you — from a prescription, or from the person taking it."
            action={<ButtonLink href="/medications/new">Add a routine</ButtonLink>} />
        </Card>
      ) : (
        <div className="space-y-4">
          {schedules.map((s) => {
            const tally = checkinTally(user.id, s.id, 30);
            const canManage = can(user.id, 'medications:manage', s.care_profile_id);
            const times = parseList(s.times_of_day);
            return (
              <Card key={s.id} id={s.id}>
                <CardHead
                  title={`${s.medication_name}${s.strength ? ` ${s.strength}` : ''}`}
                  sub={`${s.profile_name}${s.form ? ` · ${s.form}` : ''}`}
                  action={<Badge tone={s.status === 'active' ? 'ok' : 'neutral'}>
                    {s.status === 'active' ? 'Active' : 'Discontinued'}
                  </Badge>}
                />
                <dl className="px-5 py-2">
                  <DefinitionRow term="Instruction, as recorded">
                    <span className="font-medium">&ldquo;{s.dose_instruction}&rdquo;</span>
                  </DefinitionRow>
                  <DefinitionRow term="Confirmed by">
                    {s.confirmed_by_name} · {SOURCE_LABELS[s.instruction_source]}
                    <span className="block text-sm text-faint">
                      on {formatDateTime(s.confirmed_at, tz, settings.locale)}
                    </span>
                  </DefinitionRow>
                  <DefinitionRow term="Reminder times">
                    {times.join(', ')} ({s.timezone})
                  </DefinitionRow>
                  <DefinitionRow term="Dates">
                    {formatDate(s.start_date, tz, settings.locale)}
                    {s.end_date ? ` to ${formatDate(s.end_date, tz, settings.locale)}` : ' onwards'}
                  </DefinitionRow>
                  {s.refill_reminder_date ? (
                    <DefinitionRow term="Refill reminder">
                      {formatDate(s.refill_reminder_date, tz, settings.locale)}
                    </DefinitionRow>
                  ) : null}
                  {s.prescription_document_id ? (
                    <DefinitionRow term="Prescription">
                      <Link href={`/records/${s.prescription_document_id}`}
                            className="font-medium text-accent hover:underline">
                        View the attached prescription
                      </Link>
                    </DefinitionRow>
                  ) : null}
                  {s.notes ? <DefinitionRow term="Notes">{s.notes}</DefinitionRow> : null}
                  {s.status === 'discontinued' ? (
                    <DefinitionRow term="Stopped">
                      {s.discontinued_at ? formatDate(s.discontinued_at.slice(0, 10), tz, settings.locale) : ''}
                      {s.discontinued_reason ? ` — ${s.discontinued_reason}` : ''}
                    </DefinitionRow>
                  ) : null}
                </dl>

                <div className="border-t border-line px-5 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                    Self-reported check-ins, last 30 days
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <span className="text-ok">Taken: <strong>{tally.tally.taken}</strong></span>
                    <span className="text-warn">Skipped: <strong>{tally.tally.skipped}</strong></span>
                    <span className="text-muted">Not confirmed: <strong>{tally.tally.not_confirmed}</strong></span>
                    <span className="text-muted">Snoozed: <strong>{tally.tally.snoozed}</strong></span>
                  </div>
                  <p className="mt-2 text-xs text-faint">{tally.note}</p>
                </div>

                {canManage && s.status === 'active' ? (
                  <div className="border-t border-line p-5">
                    <Disclosure summary="Stop this routine">
                      <form action={discontinueScheduleAction} className="space-y-3">
                        <input type="hidden" name="scheduleId" value={s.id} />
                        <Field label="Why is it stopping?" name="reason" required
                               hint="Recorded so the history still makes sense in a year.">
                          <Input name="reason" required maxLength={200}
                                 placeholder="e.g. Course finished / changed by Dr. Nair on 2 April" />
                        </Field>
                        <ConfirmSubmit label="Stop this routine"
                          title={`Stop ${s.medication_name}?`}
                          confirmLabel="Yes, stop it"
                          body={<p>
                            Future reminders are cancelled and unanswered future slots removed.
                            Past check-ins are kept. This is a record-keeping action — it is not
                            medical advice, and stopping a medicine is a decision for a clinician.
                          </p>} />
                      </form>
                    </Disclosure>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <SafetyNote>
        Dose instructions are shown exactly as entered. If what you see does not match what you
        were told, confirm with the prescribing clinician before acting on either.
      </SafetyNote>
    </div>
  );
}

function CheckinButton({ scheduleId, slot, status, label }: {
  scheduleId: string; slot: string; status: 'taken' | 'skipped' | 'snoozed'; label: string;
}) {
  return (
    <form action={recordCheckinAction}>
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <input type="hidden" name="scheduledFor" value={slot} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="back" value="/medications" />
      <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">{label}</SubmitButton>
    </form>
  );
}

function parseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}
