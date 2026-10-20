import { one } from '../db/index.ts';
import { nowIso } from './time.ts';
import { profileScopeFilter } from './authz.ts';
import { accessibleProfiles } from './profiles.ts';
import { listTasks } from './tasks.ts';
import { upcomingAppointments } from './appointments.ts';
import { unconfirmedCheckins } from './medications.ts';
import { listDocuments } from './documents.ts';

/**
 * CARE COORDINATION ANALYTICS
 *
 * Deliberately about administration, never about health. There are no risk
 * scores, severity ratings, predictions or adherence grades here, and there must
 * never be. Every metric carries the definition used to compute it so a number
 * on screen can be checked against the records behind it.
 */

export type Metric = {
  key: string; label: string; value: number; definition: string;
  tone: 'neutral' | 'attention' | 'good';
  link?: string;
};

export function coordinationMetrics(userId: string): Metric[] {
  const open = listTasks(userId, { openOnly: true, limit: 1000 });
  const overdue = open.filter((t) => t.due_at && t.due_at < nowIso());
  const unassigned = open.filter((t) => !t.assignee_user_id);
  const upcoming = upcomingAppointments(userId, 14, 1000);
  const unassignedAppointments = upcoming.filter((a) => !a.responsible_user_id);
  const completed = countCompletedTasks(userId, 30);
  const handovers = countHandovers(userId, 30);
  const documents = listDocuments(userId, {
    from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), limit: 1000,
  });
  const unconfirmed = unconfirmedCheckins(userId, 1000);

  return [
    { key: 'open_tasks', label: 'Open care tasks', value: open.length, tone: 'neutral',
      definition: 'Tasks with status pending, accepted or in progress, on profiles you can see tasks for.',
      link: '/planner' },
    { key: 'overdue_tasks', label: 'Overdue tasks', value: overdue.length,
      tone: overdue.length ? 'attention' : 'good',
      definition: 'Open tasks whose due date and time has already passed.', link: '/planner' },
    { key: 'unassigned_tasks', label: 'Tasks with nobody assigned', value: unassigned.length,
      tone: unassigned.length ? 'attention' : 'good',
      definition: 'Open tasks with no assignee.', link: '/planner' },
    { key: 'upcoming_appointments', label: 'Appointments in 14 days', value: upcoming.length,
      tone: 'neutral',
      definition: 'Appointments starting within 14 days that are not cancelled.',
      link: '/appointments' },
    { key: 'unassigned_appointments', label: 'Appointments with nobody responsible',
      value: unassignedAppointments.length,
      tone: unassignedAppointments.length ? 'attention' : 'good',
      definition: 'Upcoming appointments within 14 days with no responsible person set.',
      link: '/appointments' },
    { key: 'completed_tasks', label: 'Tasks completed (30 days)', value: completed, tone: 'good',
      definition: 'Tasks a person marked completed in the last 30 days. Completion is only ever set by an explicit action.',
      link: '/planner' },
    { key: 'handovers', label: 'Caregiver handovers (30 days)', value: handovers, tone: 'neutral',
      definition: 'Handover requests accepted in the last 30 days.' },
    { key: 'documents_added', label: 'Documents added (30 days)', value: documents.length,
      tone: 'neutral',
      definition: 'Documents dated within the last 30 days that you can read.', link: '/records' },
    { key: 'unconfirmed_doses', label: 'Dose slots nobody answered', value: unconfirmed.length,
      tone: unconfirmed.length ? 'attention' : 'good',
      definition: 'Past medication reminder slots still marked "not confirmed". This counts unanswered reminders — it is NOT a count of missed doses and not an adherence measure.',
      link: '/medications' },
  ];
}

function countCompletedTasks(userId: string, days: number): number {
  const scope = profileScopeFilter(userId, 'tasks:view', 'care_profile_id');
  return one<{ n: number }>(
    `SELECT count(*) n FROM care_tasks
     WHERE ${scope.sql} AND status = 'completed' AND completed_at >= ? AND deleted_at IS NULL`,
    ...scope.params, new Date(Date.now() - days * 86_400_000).toISOString(),
  )?.n ?? 0;
}

function countHandovers(userId: string, days: number): number {
  const scope = profileScopeFilter(userId, 'tasks:view', 't.care_profile_id');
  return one<{ n: number }>(
    `SELECT count(*) n FROM task_handovers h JOIN care_tasks t ON t.id = h.task_id
     WHERE ${scope.sql} AND h.status = 'accepted' AND h.responded_at >= ?`,
    ...scope.params, new Date(Date.now() - days * 86_400_000).toISOString(),
  )?.n ?? 0;
}

export type CaregiverLoad = { name: string; open: number; overdue: number; completed30d: number };

/** Who is carrying what. Used to spot an unbalanced or unassigned workload. */
export function caregiverLoad(userId: string): CaregiverLoad[] {
  const open = listTasks(userId, { openOnly: true, limit: 1000 });
  const completed = listTasks(userId, { status: 'completed', limit: 1000 });
  const byName = new Map<string, CaregiverLoad>();
  const bump = (name: string, field: keyof Omit<CaregiverLoad, 'name'>) => {
    const row = byName.get(name) ?? { name, open: 0, overdue: 0, completed30d: 0 };
    row[field] += 1;
    byName.set(name, row);
  };
  for (const t of open) {
    const name = t.assignee_name ?? 'Nobody assigned';
    bump(name, 'open');
    if (t.due_at && t.due_at < nowIso()) bump(name, 'overdue');
  }
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (const t of completed) {
    if (t.completed_at && t.completed_at >= since) {
      bump(t.completed_by_name ?? t.assignee_name ?? 'Nobody assigned', 'completed30d');
    }
  }
  return [...byName.values()].sort((a, b) => b.open - a.open);
}

export type WeeklyPoint = { weekStart: string; created: number; completed: number };

/** Twelve weeks of task throughput, for the trend chart. */
export function weeklyTaskTrend(userId: string, weeks = 12): WeeklyPoint[] {
  const tasks = listTasks(userId, { limit: 5000 });
  const points: WeeklyPoint[] = [];
  const msWeek = 7 * 86_400_000;
  const now = Date.now();
  for (let i = weeks - 1; i >= 0; i--) {
    const start = now - (i + 1) * msWeek;
    const end = now - i * msWeek;
    const weekStart = new Date(start).toISOString().slice(0, 10);
    points.push({
      weekStart,
      created: tasks.filter((t) => {
        const at = new Date(t.created_at).getTime();
        return at >= start && at < end;
      }).length,
      completed: tasks.filter((t) => {
        if (!t.completed_at) return false;
        const at = new Date(t.completed_at).getTime();
        return at >= start && at < end;
      }).length,
    });
  }
  return points;
}

export function profileSummary(userId: string) {
  return accessibleProfiles(userId).map((p) => ({
    id: p.id,
    name: p.display_name,
    access: p.access,
    openTasks: listTasks(userId, { careProfileId: p.id, openOnly: true, limit: 500 }).length,
    appointments: upcomingAppointments(userId, 30, 500).filter((a) => a.care_profile_id === p.id).length,
    documents: listDocuments(userId, { careProfileId: p.id, limit: 500 }).length,
  }));
}
