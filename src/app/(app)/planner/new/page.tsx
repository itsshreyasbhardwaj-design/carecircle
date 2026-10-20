import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { circlesFor, members } from '@/lib/circles';
import { can } from '@/lib/authz';
import { listAppointments } from '@/lib/appointments';
import { createTaskAction } from '@/app/actions/planner';
import {
  Card, CardHead, Field, Flash, Input, Notice, PageHead, Select, Textarea,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Create a care task' };

export default async function NewTaskPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; appointment?: string; error?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;

  const profiles = accessibleProfiles(user.id)
    .filter((p) => p.access === 'owner' || p.scopes.includes('tasks:manage'));
  const target = sp.profile && profiles.some((p) => p.id === sp.profile) ? sp.profile : profiles[0]?.id;

  const assignable = new Map<string, string>();
  for (const circle of circlesFor(user.id)) {
    for (const m of members(circle.id)) {
      if (target && can(m.user_id, 'tasks:view', target)) assignable.set(m.user_id, m.full_name);
    }
  }
  assignable.set(user.id, `${user.full_name} (you)`);

  const appointments = target
    ? listAppointments(user.id, { careProfileId: target, from: new Date().toISOString(), limit: 50 })
    : [];

  return (
    <div className="space-y-6">
      <Flash error={sp.error} />
      <PageHead title="Create a care task"
                sub="An administrative job with an owner and a deadline — booking, collecting, chasing, arranging." />

      {profiles.length === 0 ? (
        <Notice tone="warn" title="No profile you can create tasks for">
          You need a profile of your own, or the &ldquo;create and update care tasks&rdquo;
          permission on someone else&rsquo;s.
        </Notice>
      ) : (
        <Card>
          <CardHead title="Task details" />
          <form action={createTaskAction} className="space-y-5 p-5">
            <Field label="Who is this task about?" name="careProfileId" required>
              <Select name="careProfileId" required defaultValue={target}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}{p.access === 'granted' ? ' (shared with you)' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="What needs doing?" name="title" required>
              <Input name="title" required maxLength={160} autoFocus
                     placeholder="e.g. Collect the lab report from the clinic" />
            </Field>

            <Field label="Any details" name="description">
              <Textarea name="description" rows={3} maxLength={2000}
                        placeholder="e.g. Reception desk, ask for the report under the March visit" />
            </Field>

            <Field label="Who will do it?" name="assigneeUserId"
                   hint="Only people who can already see this profile's tasks are listed. Assigning someone never grants them access — share the permission first if they are missing.">
              <Select name="assigneeUserId" defaultValue="">
                <option value="">Nobody yet</option>
                {[...assignable.entries()].map(([uid, name]) => (
                  <option key={uid} value={uid}>{name}</option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Due date" name="dueDate">
                <Input name="dueDate" type="date" />
              </Field>
              <Field label="Due time" name="dueTime" hint="Defaults to 9:00 am.">
                <Input name="dueTime" type="time" />
              </Field>
              <Field label="Priority" name="priority">
                <Select name="priority" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </Select>
              </Field>
            </div>
            <input type="hidden" name="timezone" value={settings.timezone} />

            {appointments.length > 0 ? (
              <Field label="Related appointment" name="appointmentId" hint="Optional.">
                <Select name="appointmentId" defaultValue={sp.appointment ?? ''}>
                  <option value="">Not related to an appointment</option>
                  {appointments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} — {a.starts_at.slice(0, 10)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <SubmitButton pendingLabel="Creating…">Create task</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
