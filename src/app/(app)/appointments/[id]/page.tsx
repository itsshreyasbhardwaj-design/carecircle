import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSettings, requireUser } from '@/lib/session';
import {
  APPOINTMENT_STATUSES, PREP_KINDS, PREP_KIND_LABELS, STATUS_LABELS, appointmentDocuments,
  getAppointment, prepItems,
} from '@/lib/appointments';
import { listDocuments, CATEGORY_LABELS } from '@/lib/documents';
import { circlesFor, members } from '@/lib/circles';
import { can } from '@/lib/authz';
import { formatDate, formatDateTime, relative, utcToLocalParts } from '@/lib/time';
import {
  addPrepItemAction, assignAppointmentAction, deleteAppointmentAction, linkDocumentAction,
  removePrepItemAction, rescheduleAppointmentAction, setAppointmentStatusAction,
  togglePrepItemAction, unlinkDocumentAction, updateAppointmentAction,
} from '@/app/actions/planner';
import {
  Badge, Card, CardHead, Checkbox, DefinitionRow, Disclosure, EmptyState, Field, Flash, Input,
  Notice, PageHead, Select, Textarea,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/client';

export const metadata = { title: 'Appointment' };

export default async function AppointmentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const { id } = await params;
  const sp = await searchParams;

  const appt = getAppointment(user.id, id);
  if (!appt) notFound();

  const canManage = can(user.id, 'appointments:manage', appt.care_profile_id);
  const prep = prepItems(user.id, id);
  const docs = appointmentDocuments(user.id, id);
  const available = listDocuments(user.id, { careProfileId: appt.care_profile_id, limit: 100 })
    .filter((d) => !docs.some((x) => x.id === d.id));
  const local = utcToLocalParts(appt.starts_at, appt.timezone);

  const assignable = new Map<string, string>();
  for (const circle of circlesFor(user.id)) {
    for (const m of members(circle.id)) {
      if (can(m.user_id, 'appointments:view', appt.care_profile_id)) {
        assignable.set(m.user_id, m.full_name);
      }
    }
  }
  assignable.set(user.id, `${user.full_name} (you)`);

  const questions = prep.filter((p) => p.kind === 'question');
  const others = prep.filter((p) => p.kind !== 'question');

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead
        title={appt.title}
        sub={<>
          <Link href={`/profiles/${appt.care_profile_id}`} className="font-medium text-accent hover:underline">
            {appt.profile_name}
          </Link>
          {' · '}{formatDateTime(appt.starts_at, appt.timezone, settings.locale)}
          {' · '}{appt.timezone}
        </>}
        action={<Badge tone={appt.status === 'cancelled' ? 'bad' : 'accent'}>
          {STATUS_LABELS[appt.status]}
        </Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHead title="Preparation packet"
                      sub="Built only from what people have entered. CareCircle never invents medical preparation instructions." />
            <div className="space-y-5 px-5 py-4">
              <section>
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                  Questions for the doctor
                </h3>
                {questions.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    None saved yet. Writing them down beforehand is the single most useful thing
                    you can do for a short consultation.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {questions.map((item) => (
                      <PrepRow key={item.id} item={item} appointmentId={id} canManage={canManage} />
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                  Everything else
                </h3>
                {others.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">Nothing else recorded.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {others.map((item) => (
                      <PrepRow key={item.id} item={item} appointmentId={id} canManage={canManage} />
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {canManage ? (
              <div className="border-t border-line p-5">
                <Disclosure summary="Add a preparation item">
                  <form action={addPrepItemAction} className="space-y-4">
                    <input type="hidden" name="appointmentId" value={id} />
                    <Field label="Kind" name="kind" required>
                      <Select name="kind" required defaultValue="question">
                        {PREP_KINDS.map((k) => (
                          <option key={k} value={k}>{PREP_KIND_LABELS[k]}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="What is it?" name="text" required>
                      <Textarea name="text" rows={2} required maxLength={400}
                                placeholder="e.g. Ask whether the evening tablet can move earlier" />
                    </Field>
                    <Checkbox name="fromClinic"
                      label="This is an instruction the clinic actually gave us"
                      hint="Tick only when you are copying something a clinician said or wrote. Instructions are never generated by this app." />
                    <SubmitButton variant="secondary">Add item</SubmitButton>
                  </form>
                </Disclosure>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHead title="Documents to bring"
                      sub="Only documents you are allowed to read can be attached or shown." />
            {docs.length === 0 ? (
              <EmptyState title="No documents attached" />
            ) : (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/records/${d.id}`} className="font-medium text-ink hover:text-accent">
                        {d.title}
                      </Link>
                      <p className="text-sm text-muted">
                        {CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS]}
                        {d.document_date ? ` · ${d.document_date}` : ''}
                      </p>
                    </div>
                    {canManage ? (
                      <form action={unlinkDocumentAction}>
                        <input type="hidden" name="appointmentId" value={id} />
                        <input type="hidden" name="documentId" value={d.id} />
                        <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                          Remove
                        </SubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canManage && available.length > 0 ? (
              <div className="border-t border-line p-5">
                <form action={linkDocumentAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="appointmentId" value={id} />
                  <Field label="Attach a document" name="documentId" className="min-w-60 flex-1">
                    <Select name="documentId" required>
                      {available.map((d) => (
                        <option key={d.id} value={d.id}>{d.title}</option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton variant="secondary">Attach</SubmitButton>
                </form>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHead title="Details" />
            <dl className="px-5 py-2">
              <DefinitionRow term="Person">{appt.profile_name}</DefinitionRow>
              <DefinitionRow term="When">
                {formatDateTime(appt.starts_at, appt.timezone, settings.locale)} ({appt.timezone})
                <span className="block text-sm text-faint">{relative(appt.starts_at, settings.locale)}</span>
              </DefinitionRow>
              <DefinitionRow term="Provider">
                {appt.provider_name ?? <span className="text-faint">Not set</span>}
              </DefinitionRow>
              <DefinitionRow term="Location">
                {appt.location ?? <span className="text-faint">Not set</span>}
              </DefinitionRow>
              <DefinitionRow term="Lasts">
                {appt.duration_minutes ? `${appt.duration_minutes} minutes` : <span className="text-faint">Not set</span>}
              </DefinitionRow>
              <DefinitionRow term="Responsible">
                {appt.responsible_name ?? <span className="text-faint">Nobody yet</span>}
              </DefinitionRow>
              <DefinitionRow term="Follow-up">
                {appt.followup_date
                  ? formatDate(appt.followup_date, settings.timezone, settings.locale)
                  : <span className="text-faint">None recorded</span>}
              </DefinitionRow>
              <DefinitionRow term="Notes">
                {appt.notes ?? <span className="text-faint">None</span>}
              </DefinitionRow>
              <DefinitionRow term="Outcome">
                {appt.outcome_note ?? <span className="text-faint">Not recorded</span>}
              </DefinitionRow>
            </dl>
          </Card>

          {canManage ? (
            <>
              <Card>
                <CardHead title="Who is taking them" />
                <form action={assignAppointmentAction} className="space-y-4 p-5">
                  <input type="hidden" name="appointmentId" value={id} />
                  <Field label="Responsible person" name="responsibleUserId"
                         hint="Only people who can already see this profile's appointments appear here.">
                    <Select name="responsibleUserId" defaultValue={appt.responsible_user_id ?? ''}>
                      <option value="">Nobody</option>
                      {[...assignable.entries()].map(([uid, name]) => (
                        <option key={uid} value={uid}>{name}</option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton variant="secondary">Update</SubmitButton>
                </form>
              </Card>

              <Card>
                <CardHead title="Status" />
                <form action={setAppointmentStatusAction} className="space-y-4 p-5">
                  <input type="hidden" name="appointmentId" value={id} />
                  <Field label="Set status" name="status" required>
                    <Select name="status" required defaultValue={appt.status}>
                      {APPOINTMENT_STATUSES.filter((s) => s !== 'rescheduled').map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Outcome note" name="outcomeNote"
                         hint="What happened, in administrative terms. Not a clinical record.">
                    <Textarea name="outcomeNote" rows={2} maxLength={1000}
                              defaultValue={appt.outcome_note ?? ''} />
                  </Field>
                  <SubmitButton variant="secondary">Save status</SubmitButton>
                </form>
              </Card>

              <Card>
                <CardHead title="Reschedule"
                          sub="The original is kept and marked rescheduled, so the history stays intact." />
                <form action={rescheduleAppointmentAction} className="space-y-4 p-5">
                  <input type="hidden" name="appointmentId" value={id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="New date" name="date" required>
                      <Input name="date" type="date" required defaultValue={local.date} />
                    </Field>
                    <Field label="New time" name="time" required>
                      <Input name="time" type="time" required defaultValue={local.time} />
                    </Field>
                  </div>
                  <input type="hidden" name="timezone" value={appt.timezone} />
                  <Field label="Reason" name="reason">
                    <Input name="reason" maxLength={300} placeholder="e.g. Clinic moved the slot" />
                  </Field>
                  <SubmitButton variant="secondary">Reschedule</SubmitButton>
                </form>
              </Card>

              <Card>
                <CardHead title="Edit details" />
                <form action={updateAppointmentAction} className="space-y-4 p-5">
                  <input type="hidden" name="appointmentId" value={id} />
                  <Field label="Title" name="title">
                    <Input name="title" maxLength={160} defaultValue={appt.title} />
                  </Field>
                  <Field label="Provider" name="providerName">
                    <Input name="providerName" maxLength={160} defaultValue={appt.provider_name ?? ''} />
                  </Field>
                  <Field label="Location" name="location">
                    <Input name="location" maxLength={200} defaultValue={appt.location ?? ''} />
                  </Field>
                  <Field label="Notes" name="notes">
                    <Textarea name="notes" rows={3} maxLength={2000} defaultValue={appt.notes ?? ''} />
                  </Field>
                  <Field label="Follow-up date" name="followupDate">
                    <Input name="followupDate" type="date" defaultValue={appt.followup_date ?? ''} />
                  </Field>
                  <SubmitButton variant="secondary">Save changes</SubmitButton>
                </form>
              </Card>

              <Card className="border-bad/30">
                <CardHead title="Remove this appointment" />
                <form action={deleteAppointmentAction} className="p-5">
                  <input type="hidden" name="appointmentId" value={id} />
                  <ConfirmSubmit label="Delete appointment"
                    title={`Delete “${appt.title}”?`} confirmLabel="Yes, delete it"
                    body={<p>Its scheduled reminders are cancelled. Cancelling instead keeps the record — consider setting the status to Cancelled.</p>} />
                </form>
              </Card>
            </>
          ) : (
            <Notice tone="neutral" title="View only">
              You can see this appointment but not change it. The person it belongs to can grant
              the &ldquo;add and change appointments&rdquo; permission if you need to.
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}

function PrepRow({ item, appointmentId, canManage }: {
  item: { id: string; kind: string; text: string; source: string; done: number };
  appointmentId: string; canManage: boolean;
}) {
  return (
    <li className="flex flex-wrap items-start gap-3 rounded-card border border-line bg-surface-2 px-3 py-2.5">
      {canManage ? (
        <form action={togglePrepItemAction} className="shrink-0 pt-0.5">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="done" value={item.done ? '' : 'on'} />
          <SubmitButton variant="ghost" className="min-h-0 px-2 py-1 text-sm">
            {item.done ? '☑' : '☐'}
            <span className="sr-only">{item.done ? 'Mark not done' : 'Mark done'}</span>
          </SubmitButton>
        </form>
      ) : (
        <span aria-hidden="true" className="pt-0.5">{item.done ? '☑' : '☐'}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-[0.95rem] ${item.done ? 'text-faint line-through' : 'text-ink'}`}>
          {item.text}
        </p>
        <p className="text-xs text-faint">
          {PREP_KIND_LABELS[item.kind as keyof typeof PREP_KIND_LABELS]}
          {item.source === 'clinician_provided' ? ' · from the clinic' : ' · added by the family'}
        </p>
      </div>
      {canManage ? (
        <form action={removePrepItemAction}>
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <input type="hidden" name="itemId" value={item.id} />
          <SubmitButton variant="ghost" className="min-h-0 px-2 py-1 text-sm">
            Remove<span className="sr-only"> {item.text}</span>
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}
