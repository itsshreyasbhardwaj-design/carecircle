import { all, one, run, tx } from '../db/index.ts';
import { newId } from './ids.ts';
import { addDays, nowIso } from './time.ts';
import { audit, recordActivity } from './audit.ts';
import { AuthzError, assertCan, can, canReadDocument, profileScopeFilter } from './authz.ts';
import { cancelRemindersFor, notify, scheduleTaskReminder } from './reminders.ts';

export const TASK_STATUSES = [
  'pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'unable_to_complete',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending', accepted: 'Accepted', in_progress: 'In progress',
  completed: 'Completed', cancelled: 'Cancelled', unable_to_complete: 'Unable to complete',
};

/** Only these transitions are allowed, so a status can never be skipped into. */
const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  pending: ['accepted', 'in_progress', 'cancelled', 'unable_to_complete'],
  accepted: ['in_progress', 'completed', 'cancelled', 'unable_to_complete'],
  in_progress: ['completed', 'cancelled', 'unable_to_complete', 'accepted'],
  completed: [],
  cancelled: ['pending'],
  unable_to_complete: ['pending', 'accepted'],
};

export type CareTask = {
  id: string; care_profile_id: string; profile_name: string; title: string;
  description: string | null; assignee_user_id: string | null; assignee_name: string | null;
  due_at: string | null; priority: 'low' | 'normal' | 'high'; status: TaskStatus;
  appointment_id: string | null; appointment_title: string | null;
  completed_at: string | null; completed_by_name: string | null; completion_note: string | null;
  created_at: string; updated_at: string; created_by_name: string;
};

const SELECT = `
  SELECT t.*, p.display_name AS profile_name, a.full_name AS assignee_name,
         c.full_name AS created_by_name, done.full_name AS completed_by_name,
         ap.title AS appointment_title
  FROM care_tasks t
  JOIN care_profiles p ON p.id = t.care_profile_id
  JOIN users c ON c.id = t.created_by_user_id
  LEFT JOIN users a ON a.id = t.assignee_user_id
  LEFT JOIN users done ON done.id = t.completed_by_user_id
  LEFT JOIN appointments ap ON ap.id = t.appointment_id`;

export function createTask(input: {
  actorUserId: string; careProfileId: string; title: string; description?: string | null;
  assigneeUserId?: string | null; dueAt?: string | null;
  priority?: 'low' | 'normal' | 'high'; appointmentId?: string | null; isDemo?: boolean;
}): string {
  assertCan(input.actorUserId, 'tasks:manage', input.careProfileId, 'task:create');
  if (input.assigneeUserId) assertTaskAssignable(input.assigneeUserId, input.careProfileId);
  const id = newId('tsk');
  const now = nowIso();
  tx((d) => {
    d.prepare(
      `INSERT INTO care_tasks
       (id, care_profile_id, title, description, assignee_user_id, due_at, priority, status,
        appointment_id, is_demo, created_by_user_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?,?)`,
    ).run(id, input.careProfileId, input.title.trim(), input.description ?? null,
          input.assigneeUserId ?? null, input.dueAt ?? null, input.priority ?? 'normal',
          input.appointmentId ?? null, input.isDemo ? 1 : 0, input.actorUserId, now, now);
    d.prepare(
      `INSERT INTO task_events (id, task_id, actor_user_id, kind, to_value, occurred_at)
       VALUES (?,?,?,'created','pending',?)`,
    ).run(newId('tev'), id, input.actorUserId, now);
    if (input.assigneeUserId) {
      d.prepare(
        `INSERT INTO task_events (id, task_id, actor_user_id, kind, to_value, occurred_at)
         VALUES (?,?,?,'assigned',?,?)`,
      ).run(newId('tev'), id, input.actorUserId, input.assigneeUserId, now);
    }
  });
  if (input.dueAt) scheduleTaskReminder(id);
  if (input.assigneeUserId && input.assigneeUserId !== input.actorUserId) {
    notify({
      userId: input.assigneeUserId, careProfileId: input.careProfileId, kind: 'task_assigned',
      title: 'A care task was assigned to you',
      body: `${input.title.trim()} — please accept or decline.`,
      link: `/tasks/${id}`,
    });
  }
  audit({ actorUserId: input.actorUserId, action: 'task:create', resourceType: 'care_task',
          resourceId: id, careProfileId: input.careProfileId, outcome: 'allowed' });
  recordActivity({ careProfileId: input.careProfileId, actorUserId: input.actorUserId,
                   kind: 'task_created', summary: `Task created: ${input.title.trim()}`,
                   subjectType: 'care_task', subjectId: id, requiredScope: 'tasks:view' });
  return id;
}

/** Assignment never widens access: the assignee must already be able to see tasks here. */
export function assertTaskAssignable(userId: string, careProfileId: string): void {
  if (can(userId, 'tasks:view', careProfileId)) return;
  throw new AuthzError(
    'That person cannot see care tasks for this profile yet. Share the "See care tasks" permission first, then assign them.',
  );
}

export function listTasks(userId: string, filter: {
  careProfileId?: string | null; status?: TaskStatus | null; assigneeUserId?: string | null;
  overdueOnly?: boolean; openOnly?: boolean; limit?: number; offset?: number;
} = {}): CareTask[] {
  const scope = profileScopeFilter(userId, 'tasks:view', 't.care_profile_id');
  const where = [scope.sql, 't.deleted_at IS NULL'];
  const params: unknown[] = [...scope.params];
  if (filter.careProfileId) { where.push('t.care_profile_id = ?'); params.push(filter.careProfileId); }
  if (filter.status) { where.push('t.status = ?'); params.push(filter.status); }
  if (filter.assigneeUserId) { where.push('t.assignee_user_id = ?'); params.push(filter.assigneeUserId); }
  if (filter.openOnly) where.push("t.status IN ('pending','accepted','in_progress')");
  if (filter.overdueOnly) {
    where.push("t.due_at IS NOT NULL AND t.due_at < ? AND t.status IN ('pending','accepted','in_progress')");
    params.push(nowIso());
  }
  params.push(filter.limit ?? 100, filter.offset ?? 0);
  return all<CareTask>(
    `${SELECT} WHERE ${where.join(' AND ')}
     ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
              t.due_at IS NULL, t.due_at LIMIT ? OFFSET ?`,
    ...params,
  );
}

export function getTask(userId: string, id: string): CareTask | undefined {
  const row = one<CareTask>(`${SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`, id);
  if (!row) return undefined;
  assertCan(userId, 'tasks:view', row.care_profile_id, 'task:read');
  return row;
}

function requireTask(userId: string, id: string, scope: 'tasks:view' | 'tasks:manage'): CareTask {
  const row = one<CareTask>(`${SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`, id);
  if (!row) throw new AuthzError('That task no longer exists.');
  assertCan(userId, scope, row.care_profile_id, `task:${scope}`);
  return row;
}

/**
 * Status changes are explicit human actions. Nothing here is triggered by a
 * reminder being sent or a notification being read — a task is only complete
 * when a person says it is.
 */
export function setTaskStatus(input: {
  actorUserId: string; taskId: string; status: TaskStatus; note?: string | null;
}): void {
  const task = requireTask(input.actorUserId, input.taskId, 'tasks:view');
  // The assignee may move their own task along; otherwise manage rights are needed.
  if (task.assignee_user_id !== input.actorUserId) {
    assertCan(input.actorUserId, 'tasks:manage', task.care_profile_id, 'task:status');
  }
  if (!ALLOWED[task.status].includes(input.status)) {
    throw new Error(
      `A task that is "${TASK_STATUS_LABELS[task.status]}" cannot become "${TASK_STATUS_LABELS[input.status]}".`,
    );
  }
  const now = nowIso();
  tx((d) => {
    d.prepare(
      `UPDATE care_tasks SET status = ?, updated_at = ?,
         completed_at = CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
         completed_by_user_id = CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
         completion_note = COALESCE(?, completion_note)
       WHERE id = ?`,
    ).run(input.status, now, input.status, now, input.status, input.actorUserId,
          input.note ?? null, input.taskId);
    d.prepare(
      `INSERT INTO task_events (id, task_id, actor_user_id, kind, from_value, to_value, body, occurred_at)
       VALUES (?,?,?,'status_changed',?,?,?,?)`,
    ).run(newId('tev'), input.taskId, input.actorUserId, task.status, input.status,
          input.note ?? null, now);
  });
  if (input.status === 'completed' || input.status === 'cancelled') {
    cancelRemindersFor('care_task', input.taskId);
  }
  audit({ actorUserId: input.actorUserId, action: 'task:status', resourceType: 'care_task',
          resourceId: input.taskId, careProfileId: task.care_profile_id, outcome: 'allowed',
          detail: { from: task.status, to: input.status } });
  recordActivity({
    careProfileId: task.care_profile_id, actorUserId: input.actorUserId, kind: 'task_status',
    summary: `Task ${TASK_STATUS_LABELS[input.status].toLowerCase()}: ${task.title}`,
    subjectType: 'care_task', subjectId: input.taskId, requiredScope: 'tasks:view',
  });
}

export function updateTask(input: {
  actorUserId: string; taskId: string; title?: string; description?: string | null;
  dueAt?: string | null; priority?: 'low' | 'normal' | 'high';
}): void {
  const task = requireTask(input.actorUserId, input.taskId, 'tasks:manage');
  run(
    `UPDATE care_tasks SET title = COALESCE(?, title), description = COALESCE(?, description),
       due_at = COALESCE(?, due_at), priority = COALESCE(?, priority), updated_at = ?
     WHERE id = ?`,
    input.title ?? null, input.description ?? null, input.dueAt ?? null,
    input.priority ?? null, nowIso(), input.taskId,
  );
  if (input.dueAt) { cancelRemindersFor('care_task', input.taskId); scheduleTaskReminder(input.taskId); }
  audit({ actorUserId: input.actorUserId, action: 'task:update', resourceType: 'care_task',
          resourceId: input.taskId, careProfileId: task.care_profile_id, outcome: 'allowed' });
}

export function assignTask(actorUserId: string, taskId: string, assigneeUserId: string | null): void {
  const task = requireTask(actorUserId, taskId, 'tasks:manage');
  if (assigneeUserId) assertTaskAssignable(assigneeUserId, task.care_profile_id);
  const now = nowIso();
  tx((d) => {
    d.prepare('UPDATE care_tasks SET assignee_user_id = ?, updated_at = ? WHERE id = ?')
      .run(assigneeUserId, now, taskId);
    d.prepare(
      `INSERT INTO task_events (id, task_id, actor_user_id, kind, from_value, to_value, occurred_at)
       VALUES (?,?,?,'assigned',?,?,?)`,
    ).run(newId('tev'), taskId, actorUserId, task.assignee_user_id, assigneeUserId, now);
  });
  if (assigneeUserId && assigneeUserId !== actorUserId) {
    notify({ userId: assigneeUserId, careProfileId: task.care_profile_id, kind: 'task_assigned',
             title: 'A care task was assigned to you', body: task.title, link: `/tasks/${taskId}` });
  }
  audit({ actorUserId, action: 'task:assign', resourceType: 'care_task', resourceId: taskId,
          careProfileId: task.care_profile_id, outcome: 'allowed', detail: { assignee: assigneeUserId } });
}

export function commentOnTask(actorUserId: string, taskId: string, body: string): void {
  const task = requireTask(actorUserId, taskId, 'tasks:view');
  run(
    `INSERT INTO task_events (id, task_id, actor_user_id, kind, body, occurred_at)
     VALUES (?,?,?,'commented',?,?)`,
    newId('tev'), taskId, actorUserId, body.trim(), nowIso(),
  );
  // Tell the other side of the conversation, whichever side that is.
  const other = task.assignee_user_id === actorUserId ? null : task.assignee_user_id;
  if (other) {
    notify({ userId: other, careProfileId: task.care_profile_id, kind: 'task_comment',
             title: 'New comment on a care task', body: task.title, link: `/tasks/${taskId}` });
  }
}

export function taskHistory(userId: string, taskId: string) {
  requireTask(userId, taskId, 'tasks:view');
  return all<{ id: string; kind: string; from_value: string | null; to_value: string | null;
               body: string | null; occurred_at: string; actor_name: string | null }>(
    `SELECT e.id, e.kind, e.from_value, e.to_value, e.body, e.occurred_at, u.full_name AS actor_name
     FROM task_events e LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.task_id = ? ORDER BY e.occurred_at`,
    taskId,
  );
}

export function linkTaskDocument(actorUserId: string, taskId: string, documentId: string): void {
  requireTask(actorUserId, taskId, 'tasks:manage');
  if (!canReadDocument(actorUserId, documentId)) {
    throw new AuthzError('You cannot attach a document you are not allowed to read.');
  }
  run('INSERT OR IGNORE INTO task_documents (task_id, document_id, linked_at) VALUES (?,?,?)',
    taskId, documentId, nowIso());
}

export function taskDocuments(userId: string, taskId: string) {
  const rows = all<{ id: string; title: string; category: string }>(
    `SELECT d.id, d.title, d.category FROM task_documents td
     JOIN medical_documents d ON d.id = td.document_id
     WHERE td.task_id = ? AND d.deleted_at IS NULL`,
    taskId,
  );
  return rows.filter((r) => canReadDocument(userId, r.id));
}

export function deleteTask(actorUserId: string, taskId: string): void {
  const task = requireTask(actorUserId, taskId, 'tasks:manage');
  run('UPDATE care_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), taskId);
  cancelRemindersFor('care_task', taskId);
  audit({ actorUserId, action: 'task:delete', resourceType: 'care_task', resourceId: taskId,
          careProfileId: task.care_profile_id, outcome: 'allowed' });
}

// ------------------------------------------------------------------- handovers

export const HANDOVER_TTL_DAYS = 3;

export type Handover = {
  id: string; task_id: string; task_title: string; care_profile_id: string;
  from_user_id: string; from_name: string; to_user_id: string; to_name: string;
  reason: string | null; status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  requested_at: string; responded_at: string | null; expires_at: string;
};

/**
 * Hand a task to someone else.
 *
 * The proposed caregiver must ALREADY hold tasks:view on the care profile. A
 * reassignment never grants access: if they cannot see the profile's tasks, the
 * request is refused and the owner is told to share the permission first. This is
 * what stops record access leaking through a task transfer.
 */
export function requestHandover(input: {
  actorUserId: string; taskId: string; toUserId: string; reason?: string | null;
}): string {
  const task = requireTask(input.actorUserId, input.taskId, 'tasks:view');
  const isAssignee = task.assignee_user_id === input.actorUserId;
  if (!isAssignee) {
    assertCan(input.actorUserId, 'tasks:manage', task.care_profile_id, 'task:handover');
  }
  if (input.toUserId === task.assignee_user_id) {
    throw new Error('That person is already responsible for this task.');
  }
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new Error('A finished task cannot be handed over.');
  }
  // The permission check that keeps a handover from widening access.
  assertTaskAssignable(input.toUserId, task.care_profile_id);

  const id = newId('hdv');
  const now = nowIso();
  tx((d) => {
    d.prepare('UPDATE task_handovers SET status = ?, responded_at = ? WHERE task_id = ? AND status = ?')
      .run('cancelled', now, input.taskId, 'pending');
    d.prepare(
      `INSERT INTO task_handovers
       (id, task_id, from_user_id, to_user_id, reason, status, requested_at, expires_at)
       VALUES (?,?,?,?,?,'pending',?,?)`,
    ).run(id, input.taskId, input.actorUserId, input.toUserId, input.reason ?? null, now,
          addDays(now, HANDOVER_TTL_DAYS));
    d.prepare(
      `INSERT INTO task_events (id, task_id, actor_user_id, kind, to_value, body, occurred_at)
       VALUES (?,?,?,'handover_requested',?,?,?)`,
    ).run(newId('tev'), input.taskId, input.actorUserId, input.toUserId, input.reason ?? null, now);
  });
  notify({
    userId: input.toUserId, careProfileId: task.care_profile_id, kind: 'handover_requested',
    title: 'You have been asked to take over a care task',
    body: `${task.title} — for ${task.profile_name}. Please accept or decline.`,
    link: `/tasks/${input.taskId}`,
  });
  audit({ actorUserId: input.actorUserId, action: 'task:handover_request', resourceType: 'task_handover',
          resourceId: id, careProfileId: task.care_profile_id, outcome: 'allowed',
          detail: { task: input.taskId, to: input.toUserId } });
  recordActivity({ careProfileId: task.care_profile_id, actorUserId: input.actorUserId,
                   kind: 'handover_requested',
                   summary: `Handover requested for "${task.title}"`,
                   subjectType: 'care_task', subjectId: input.taskId, requiredScope: 'tasks:view' });
  return id;
}

export function respondToHandover(input: {
  actorUserId: string; handoverId: string; accept: boolean;
}): void {
  const row = one<Handover & { assignee_user_id: string | null }>(
    `SELECT h.*, t.title AS task_title, t.care_profile_id, t.assignee_user_id,
            f.full_name AS from_name, tu.full_name AS to_name
     FROM task_handovers h
     JOIN care_tasks t ON t.id = h.task_id
     JOIN users f ON f.id = h.from_user_id
     JOIN users tu ON tu.id = h.to_user_id
     WHERE h.id = ? AND h.status = 'pending'`,
    input.handoverId,
  );
  if (!row) throw new Error('That handover request is no longer open.');
  if (row.to_user_id !== input.actorUserId) {
    audit({ actorUserId: input.actorUserId, action: 'task:handover_respond',
            resourceType: 'task_handover', resourceId: input.handoverId, outcome: 'denied' });
    throw new AuthzError('Only the person asked to take over can answer this request.');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run("UPDATE task_handovers SET status = 'cancelled', responded_at = ? WHERE id = ?",
      nowIso(), input.handoverId);
    throw new Error('That handover request has expired.');
  }
  // Re-check at acceptance time: access may have been revoked since the request.
  if (input.accept) assertTaskAssignable(input.actorUserId, row.care_profile_id);

  const now = nowIso();
  tx((d) => {
    d.prepare('UPDATE task_handovers SET status = ?, responded_at = ? WHERE id = ?')
      .run(input.accept ? 'accepted' : 'declined', now, input.handoverId);
    if (input.accept) {
      d.prepare('UPDATE care_tasks SET assignee_user_id = ?, updated_at = ? WHERE id = ?')
        .run(input.actorUserId, now, row.task_id);
    }
    d.prepare(
      `INSERT INTO task_events (id, task_id, actor_user_id, kind, from_value, to_value, occurred_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(newId('tev'), row.task_id, input.actorUserId,
          input.accept ? 'handover_accepted' : 'handover_declined',
          row.from_user_id, row.to_user_id, now);
  });
  notify({
    userId: row.from_user_id, careProfileId: row.care_profile_id,
    kind: input.accept ? 'handover_accepted' : 'handover_declined',
    title: input.accept ? 'Your handover was accepted' : 'Your handover was declined',
    body: `${row.to_name} ${input.accept ? 'accepted' : 'declined'} "${row.task_title}".`,
    link: `/tasks/${row.task_id}`,
  });
  audit({ actorUserId: input.actorUserId, action: 'task:handover_respond',
          resourceType: 'task_handover', resourceId: input.handoverId,
          careProfileId: row.care_profile_id, outcome: 'allowed',
          detail: { accepted: input.accept, task: row.task_id } });
  recordActivity({
    careProfileId: row.care_profile_id, actorUserId: input.actorUserId,
    kind: input.accept ? 'handover_accepted' : 'handover_declined',
    summary: input.accept
      ? `${row.to_name} took over "${row.task_title}"`
      : `${row.to_name} declined "${row.task_title}"`,
    subjectType: 'care_task', subjectId: row.task_id, requiredScope: 'tasks:view',
  });
}

export function cancelHandover(actorUserId: string, handoverId: string): void {
  const row = one<{ from_user_id: string; task_id: string }>(
    "SELECT from_user_id, task_id FROM task_handovers WHERE id = ? AND status = 'pending'", handoverId,
  );
  if (!row) return;
  if (row.from_user_id !== actorUserId) throw new AuthzError();
  run("UPDATE task_handovers SET status = 'cancelled', responded_at = ? WHERE id = ?",
    nowIso(), handoverId);
  run(`INSERT INTO task_events (id, task_id, actor_user_id, kind, occurred_at)
       VALUES (?,?,?,'handover_cancelled',?)`,
    newId('tev'), row.task_id, actorUserId, nowIso());
}

export function pendingHandoversFor(userId: string): Handover[] {
  return all<Handover>(
    `SELECT h.*, t.title AS task_title, t.care_profile_id,
            f.full_name AS from_name, tu.full_name AS to_name
     FROM task_handovers h
     JOIN care_tasks t ON t.id = h.task_id
     JOIN users f ON f.id = h.from_user_id
     JOIN users tu ON tu.id = h.to_user_id
     WHERE h.to_user_id = ? AND h.status = 'pending' AND h.expires_at > ?
     ORDER BY h.requested_at DESC`,
    userId, nowIso(),
  );
}

export function handoverHistory(userId: string, taskId: string): Handover[] {
  requireTask(userId, taskId, 'tasks:view');
  return all<Handover>(
    `SELECT h.*, t.title AS task_title, t.care_profile_id,
            f.full_name AS from_name, tu.full_name AS to_name
     FROM task_handovers h
     JOIN care_tasks t ON t.id = h.task_id
     JOIN users f ON f.id = h.from_user_id
     JOIN users tu ON tu.id = h.to_user_id
     WHERE h.task_id = ? ORDER BY h.requested_at DESC`,
    taskId,
  );
}
