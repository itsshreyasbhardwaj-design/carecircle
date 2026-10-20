import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSettings, requireUser } from '@/lib/session';
import {
  TASK_STATUS_LABELS, getTask, handoverHistory, pendingHandoversFor,
  taskDocuments, taskHistory,
} from '@/lib/tasks';
import { listDocuments, CATEGORY_LABELS } from '@/lib/documents';
import { circlesFor, members } from '@/lib/circles';
import { can } from '@/lib/authz';
import { formatDateTime, relative, utcToLocalParts } from '@/lib/time';
import {
  assignTaskAction, cancelHandoverAction, commentOnTaskAction, deleteTaskAction,
  linkTaskDocumentAction, requestHandoverAction, respondHandoverAction, setTaskStatusAction,
  updateTaskAction,
} from '@/app/actions/planner';
import {
  Badge, Card, CardHead, DefinitionRow, EmptyState, Field, Flash, Input, Notice, PageHead,
  Select, Textarea,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/client';
import type { TaskStatus } from '@/lib/tasks';

export const metadata = { title: 'Care task' };

/** Transitions offered in the UI mirror the ones the service will accept. */
const NEXT: Record<TaskStatus, TaskStatus[]> = {
  pending: ['accepted', 'in_progress', 'cancelled', 'unable_to_complete'],
  accepted: ['in_progress', 'completed', 'cancelled', 'unable_to_complete'],
  in_progress: ['completed', 'cancelled', 'unable_to_complete'],
  completed: [],
  cancelled: ['pending'],
  unable_to_complete: ['pending', 'accepted'],
};

export default async function TaskPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const { id } = await params;
  const sp = await searchParams;

  const task = getTask(user.id, id);
  if (!task) notFound();

  const canManage = can(user.id, 'tasks:manage', task.care_profile_id);
  const isAssignee = task.assignee_user_id === user.id;
  const history = taskHistory(user.id, id);
  const docs = taskDocuments(user.id, id);
  const handovers = handoverHistory(user.id, id);
  const pendingForMe = pendingHandoversFor(user.id).find((h) => h.task_id === id);
  const pending = handovers.find((h) => h.status === 'pending');

  const candidates: { id: string; name: string; eligible: boolean }[] = [];
  const seen = new Set<string>([user.id]);
  for (const circle of circlesFor(user.id)) {
    for (const m of members(circle.id)) {
      if (seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      candidates.push({
        id: m.user_id, name: m.full_name,
        eligible: can(m.user_id, 'tasks:view', task.care_profile_id),
      });
    }
  }
  const eligible = candidates.filter((c) => c.eligible);
  const ineligible = candidates.filter((c) => !c.eligible);
  const available = listDocuments(user.id, { careProfileId: task.care_profile_id, limit: 100 })
    .filter((d) => !docs.some((x) => x.id === d.id));
  const local = task.due_at ? utcToLocalParts(task.due_at, settings.timezone) : null;

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead
        title={task.title}
        sub={<>
          <Link href={`/profiles/${task.care_profile_id}`} className="font-medium text-accent hover:underline">
            {task.profile_name}
          </Link>
          {' · '}{task.assignee_name ?? 'nobody assigned'}
          {task.due_at ? ` · due ${formatDateTime(task.due_at, settings.timezone, settings.locale)}` : ''}
        </>}
        action={<div className="flex gap-2">
          {task.priority === 'high' ? <Badge tone="bad">High priority</Badge> : null}
          <Badge tone={task.status === 'completed' ? 'ok' : 'accent'}>
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
        </div>}
      />

      {pendingForMe ? (
        <Card className="border-accent/50">
          <CardHead title="You have been asked to take this on"
                    sub={`${pendingForMe.from_name} requested the handover ${relative(pendingForMe.requested_at, settings.locale)}. It expires ${relative(pendingForMe.expires_at, settings.locale)}.`} />
          <div className="space-y-4 p-5">
            {pendingForMe.reason ? (
              <p className="rounded-card border border-line bg-surface-2 px-4 py-3 text-[0.95rem] text-ink">
                &ldquo;{pendingForMe.reason}&rdquo;
              </p>
            ) : null}
            <Notice tone="neutral">
              Accepting moves responsibility for this task to you. It does not give you access to
              any medical record — you keep exactly the permissions you already had.
            </Notice>
            <div className="flex flex-wrap gap-3">
              <form action={respondHandoverAction}>
                <input type="hidden" name="taskId" value={id} />
                <input type="hidden" name="handoverId" value={pendingForMe.id} />
                <input type="hidden" name="accept" value="on" />
                <SubmitButton>Accept and take it on</SubmitButton>
              </form>
              <form action={respondHandoverAction}>
                <input type="hidden" name="taskId" value={id} />
                <input type="hidden" name="handoverId" value={pendingForMe.id} />
                <input type="hidden" name="accept" value="" />
                <SubmitButton variant="secondary">Decline</SubmitButton>
              </form>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHead title="Details" />
            <dl className="px-5 py-2">
              <DefinitionRow term="For">{task.profile_name}</DefinitionRow>
              <DefinitionRow term="Description">
                {task.description ?? <span className="text-faint">None</span>}
              </DefinitionRow>
              <DefinitionRow term="Assigned to">
                {task.assignee_name ?? <span className="text-faint">Nobody</span>}
              </DefinitionRow>
              <DefinitionRow term="Due">
                {task.due_at
                  ? formatDateTime(task.due_at, settings.timezone, settings.locale)
                  : <span className="text-faint">No deadline</span>}
              </DefinitionRow>
              <DefinitionRow term="Priority">{task.priority}</DefinitionRow>
              <DefinitionRow term="Status">{TASK_STATUS_LABELS[task.status]}</DefinitionRow>
              <DefinitionRow term="Completed">
                {task.completed_at ? <>
                  {formatDateTime(task.completed_at, settings.timezone, settings.locale)}
                  {task.completed_by_name ? ` by ${task.completed_by_name}` : ''}
                  {task.completion_note ? <span className="block text-sm text-muted">{task.completion_note}</span> : null}
                </> : <span className="text-faint">Not completed</span>}
              </DefinitionRow>
              {task.appointment_id ? (
                <DefinitionRow term="Related appointment">
                  <Link href={`/appointments/${task.appointment_id}`}
                        className="font-medium text-accent hover:underline">
                    {task.appointment_title}
                  </Link>
                </DefinitionRow>
              ) : null}
              <DefinitionRow term="Created by">
                {task.created_by_name} · {relative(task.created_at, settings.locale)}
              </DefinitionRow>
            </dl>
          </Card>

          <Card>
            <CardHead title="Activity and comments"
                      sub="Every status change and comment, in order." />
            <ol className="divide-y divide-line">
              {history.map((e) => (
                <li key={e.id} className="px-5 py-3">
                  <p className="text-[0.95rem] text-ink">
                    <span className="font-medium">{e.actor_name ?? 'Someone'}</span>{' '}
                    {describeEvent(e)}
                  </p>
                  {e.body ? (
                    <p className="mt-1 rounded-card border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
                      {e.body}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-faint">
                    {formatDateTime(e.occurred_at, settings.timezone, settings.locale)}
                  </p>
                </li>
              ))}
            </ol>
            <div className="border-t border-line p-5">
              <form action={commentOnTaskAction} className="space-y-3">
                <input type="hidden" name="taskId" value={id} />
                <Field label="Add a comment" name="body">
                  <Textarea name="body" rows={2} maxLength={1000} required
                            placeholder="e.g. Reception says it will be ready after 4pm" />
                </Field>
                <SubmitButton variant="secondary">Post comment</SubmitButton>
              </form>
            </div>
          </Card>

          <Card>
            <CardHead title="Supporting documents"
                      sub="Only documents you may read are listed or attachable." />
            {docs.length === 0 ? <EmptyState title="Nothing attached" /> : (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.id} className="px-5 py-3">
                    <Link href={`/records/${d.id}`} className="font-medium text-ink hover:text-accent">
                      {d.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS]}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canManage && available.length > 0 ? (
              <div className="border-t border-line p-5">
                <form action={linkTaskDocumentAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="taskId" value={id} />
                  <Field label="Attach a document" name="documentId" className="min-w-60 flex-1">
                    <Select name="documentId" required>
                      {available.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </Select>
                  </Field>
                  <SubmitButton variant="secondary">Attach</SubmitButton>
                </form>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          {NEXT[task.status].length > 0 && (isAssignee || canManage) ? (
            <Card>
              <CardHead title="Update status"
                        sub="Only a person can change this. A reminder never completes a task." />
              <form action={setTaskStatusAction} className="space-y-4 p-5">
                <input type="hidden" name="taskId" value={id} />
                <Field label="New status" name="status" required>
                  <Select name="status" required>
                    {NEXT[task.status].map((s) => (
                      <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note" name="note" hint="Useful when a task could not be completed.">
                  <Textarea name="note" rows={2} maxLength={500} />
                </Field>
                <SubmitButton>Save status</SubmitButton>
              </form>
            </Card>
          ) : task.status === 'completed' ? (
            <Notice tone="ok" title="This task is complete">
              Completed tasks are final and stay in the history.
            </Notice>
          ) : null}

          {(isAssignee || canManage) && task.status !== 'completed' && task.status !== 'cancelled' ? (
            <Card>
              <CardHead title="Hand this over"
                        sub="Transfers responsibility to another authorised person, once they accept." />
              <div className="space-y-4 p-5">
                {pending ? (
                  <>
                    <Notice tone="warn" title="A handover is already pending">
                      {pending.to_name} was asked {relative(pending.requested_at, settings.locale)}.
                    </Notice>
                    {pending.from_user_id === user.id ? (
                      <form action={cancelHandoverAction}>
                        <input type="hidden" name="taskId" value={id} />
                        <input type="hidden" name="handoverId" value={pending.id} />
                        <SubmitButton variant="secondary">Cancel the request</SubmitButton>
                      </form>
                    ) : null}
                  </>
                ) : eligible.length === 0 ? (
                  <Notice tone="neutral" title="Nobody is eligible yet">
                    A handover can only go to someone who can already see this profile&rsquo;s tasks.
                    Ask {task.profile_name} to share the &ldquo;see care tasks&rdquo; permission first.
                  </Notice>
                ) : (
                  <form action={requestHandoverAction} className="space-y-4">
                    <input type="hidden" name="taskId" value={id} />
                    <Field label="Hand over to" name="toUserId" required>
                      <Select name="toUserId" required>
                        {eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Why?" name="reason" hint="They will see this with the request.">
                      <Input name="reason" maxLength={300} placeholder="e.g. Work trip on Thursday" />
                    </Field>
                    <SubmitButton variant="secondary">Request handover</SubmitButton>
                  </form>
                )}
                {ineligible.length > 0 ? (
                  <p className="text-sm text-muted">
                    Not eligible without a permission first:{' '}
                    {ineligible.map((c) => c.name).join(', ')}.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {handovers.length > 0 ? (
            <Card>
              <CardHead title="Reassignment history" />
              <ul className="divide-y divide-line">
                {handovers.map((h) => (
                  <li key={h.id} className="px-5 py-3 text-sm">
                    <p className="font-medium text-ink">
                      {h.from_name} → {h.to_name}
                    </p>
                    <p className="text-muted">
                      {h.status} · requested {relative(h.requested_at, settings.locale)}
                      {h.responded_at ? ` · answered ${relative(h.responded_at, settings.locale)}` : ''}
                    </p>
                    {h.reason ? <p className="text-faint">&ldquo;{h.reason}&rdquo;</p> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {canManage ? (
            <>
              <Card>
                <CardHead title="Reassign directly" />
                <form action={assignTaskAction} className="space-y-4 p-5">
                  <input type="hidden" name="taskId" value={id} />
                  <Field label="Assign to" name="assigneeUserId"
                         hint="Direct assignment is for coordinators. A handover asks the other person first.">
                    <Select name="assigneeUserId" defaultValue={task.assignee_user_id ?? ''}>
                      <option value="">Nobody</option>
                      <option value={user.id}>{user.full_name} (you)</option>
                      {eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                  <SubmitButton variant="secondary">Update assignee</SubmitButton>
                </form>
              </Card>

              <Card>
                <CardHead title="Edit task" />
                <form action={updateTaskAction} className="space-y-4 p-5">
                  <input type="hidden" name="taskId" value={id} />
                  <input type="hidden" name="timezone" value={settings.timezone} />
                  <Field label="Title" name="title">
                    <Input name="title" maxLength={160} defaultValue={task.title} />
                  </Field>
                  <Field label="Description" name="description">
                    <Textarea name="description" rows={3} maxLength={2000}
                              defaultValue={task.description ?? ''} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Due date" name="dueDate">
                      <Input name="dueDate" type="date" defaultValue={local?.date ?? ''} />
                    </Field>
                    <Field label="Due time" name="dueTime">
                      <Input name="dueTime" type="time" defaultValue={local?.time ?? ''} />
                    </Field>
                  </div>
                  <Field label="Priority" name="priority">
                    <Select name="priority" defaultValue={task.priority}>
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </Select>
                  </Field>
                  <SubmitButton variant="secondary">Save changes</SubmitButton>
                </form>
              </Card>

              <Card className="border-bad/30">
                <CardHead title="Remove this task" />
                <form action={deleteTaskAction} className="p-5">
                  <input type="hidden" name="taskId" value={id} />
                  <ConfirmSubmit label="Delete task" title={`Delete “${task.title}”?`}
                    confirmLabel="Yes, delete it"
                    body={<p>The task and its history are removed. Cancelling it instead keeps the record of what was planned.</p>} />
                </form>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function describeEvent(e: { kind: string; from_value: string | null; to_value: string | null }): string {
  switch (e.kind) {
    case 'created': return 'created this task';
    case 'status_changed':
      return `changed the status from ${label(e.from_value)} to ${label(e.to_value)}`;
    case 'assigned': return e.to_value ? 'changed who is assigned' : 'removed the assignee';
    case 'commented': return 'commented';
    case 'handover_requested': return 'requested a handover';
    case 'handover_accepted': return 'accepted the handover';
    case 'handover_declined': return 'declined the handover';
    case 'handover_cancelled': return 'cancelled the handover request';
    default: return e.kind;
  }
}

function label(status: string | null): string {
  if (!status) return 'none';
  return TASK_STATUS_LABELS[status as TaskStatus] ?? status;
}
