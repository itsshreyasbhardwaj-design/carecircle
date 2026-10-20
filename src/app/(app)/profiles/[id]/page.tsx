import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles, getProfile } from '@/lib/profiles';
import { SCOPE_LABELS, SCOPES, grantedScopes, ownsProfile } from '@/lib/authz';
import { consentHistory, grantsGivenBy } from '@/lib/consent';
import { listDocuments, CATEGORY_LABELS } from '@/lib/documents';
import { listAppointments } from '@/lib/appointments';
import { listTasks } from '@/lib/tasks';
import { listSchedules } from '@/lib/medications';
import { familyActivity, profileAccessHistory } from '@/lib/activity';
import { formatDate, formatDateTime, relative } from '@/lib/time';
import {
  deleteProfileAction, grantAccessAction, revokeGrantAction, updateProfileAction,
} from '@/app/actions/care';
import {
  Badge, ButtonLink, Card, CardHead, Checkbox, DefinitionRow, Disclosure, EmptyState, Field,
  Flash, Input, Notice, PageHead, Textarea,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/client';

export const metadata = { title: 'Care profile' };

export default async function ProfilePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const { id } = await params;
  const sp = await searchParams;

  const profile = getProfile(id);
  const visible = accessibleProfiles(user.id).some((p) => p.id === id);
  if (!profile || !visible) notFound();

  const isOwner = ownsProfile(user.id, id);
  const scopes = isOwner ? new Set(SCOPES) : grantedScopes(user.id, id);
  const grants = isOwner ? grantsGivenBy(user.id).filter((g) => g.care_profile_id === id) : [];
  const consent = isOwner ? consentHistory(id, 40) : [];
  const accessLog = isOwner ? profileAccessHistory(user.id, id, 30) : [];

  const docs = scopes.has('records:view') ? listDocuments(user.id, { careProfileId: id, limit: 8 }) : [];
  const appts = scopes.has('appointments:view')
    ? listAppointments(user.id, { careProfileId: id, from: new Date().toISOString(), limit: 8 }) : [];
  const tasks = scopes.has('tasks:view')
    ? listTasks(user.id, { careProfileId: id, openOnly: true, limit: 8 }) : [];
  const meds = scopes.has('medications:view') ? listSchedules(user.id, { careProfileId: id }) : [];
  const activity = scopes.has('activity:view')
    ? familyActivity(user.id, { careProfileId: id, limit: 15 }) : [];

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead
        title={profile.display_name}
        sub={isOwner
          ? 'You control this profile and decide who can see what.'
          : `Shared with you by its owner. You hold ${scopes.size} permission(s).`}
        action={isOwner ? <Badge tone="accent">Your profile</Badge> : <Badge tone="neutral">Shared</Badge>}
      />

      {profile.profile_kind === 'proxy_pending_review' ? (
        <Notice tone="warn" title="This is a dependent profile and is deliberately restricted">
          Managing records on behalf of a child, or of an adult who cannot consent, requires a
          proxy-authorisation process that has been legally reviewed. That does not exist in this
          release, so record features are switched off for this profile rather than granted on the
          strength of a tick-box. You can still keep notes and coordinate tasks.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHead title="Details" />
          <dl className="px-5 py-2">
            <DefinitionRow term="Name">{profile.display_name}</DefinitionRow>
            <DefinitionRow term="Relationship">
              {profile.is_self ? 'This is you' : profile.relationship ?? <span className="text-faint">Not set</span>}
            </DefinitionRow>
            <DefinitionRow term="Date of birth">
              {profile.date_of_birth
                ? formatDate(profile.date_of_birth, settings.timezone, settings.locale)
                : <span className="text-faint">Not set</span>}
            </DefinitionRow>
            <DefinitionRow term="Blood group">
              {profile.blood_group ?? <span className="text-faint">Not set</span>}
            </DefinitionRow>
            <DefinitionRow term="Notes">
              {profile.notes ?? <span className="text-faint">None</span>}
            </DefinitionRow>
          </dl>
          {isOwner ? (
            <div className="border-t border-line p-5">
              <Disclosure summary="Edit details">
                <form action={updateProfileAction} className="space-y-4">
                  <input type="hidden" name="profileId" value={id} />
                  <Field label="Name" name="displayName" required>
                    <Input name="displayName" required maxLength={120}
                           defaultValue={profile.display_name} />
                  </Field>
                  <Field label="Relationship" name="relationship">
                    <Input name="relationship" maxLength={60}
                           defaultValue={profile.relationship ?? ''} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Date of birth" name="dateOfBirth">
                      <Input name="dateOfBirth" type="date" defaultValue={profile.date_of_birth ?? ''} />
                    </Field>
                    <Field label="Blood group" name="bloodGroup">
                      <Input name="bloodGroup" maxLength={10} defaultValue={profile.blood_group ?? ''} />
                    </Field>
                  </div>
                  <Field label="Notes" name="notes">
                    <Textarea name="notes" rows={3} maxLength={2000} defaultValue={profile.notes ?? ''} />
                  </Field>
                  <SubmitButton variant="secondary">Save changes</SubmitButton>
                </form>
              </Disclosure>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHead title="What you can see here"
                    sub="Sections below appear only where a permission allows them." />
          <ul className="flex flex-wrap gap-2 p-5">
            {SCOPES.map((s) => (
              <li key={s}>
                <Badge tone={scopes.has(s) ? 'ok' : 'neutral'}>
                  {scopes.has(s) ? '✓ ' : '✗ '}{SCOPE_LABELS[s]}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {scopes.has('appointments:view') ? (
        <Card>
          <CardHead title="Upcoming appointments"
                    action={<ButtonLink href={`/appointments?profile=${id}`} variant="ghost"
                                        className="px-3 py-1.5 text-sm">All</ButtonLink>} />
          {appts.length === 0 ? <EmptyState title="Nothing scheduled" /> : (
            <ul className="divide-y divide-line">
              {appts.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <Link href={`/appointments/${a.id}`} className="font-medium text-ink hover:text-accent">
                    {a.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {formatDateTime(a.starts_at, settings.timezone, settings.locale)} ·
                    {' '}{a.responsible_name ?? 'nobody assigned'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {scopes.has('tasks:view') ? (
        <Card>
          <CardHead title="Open care tasks"
                    action={<ButtonLink href={`/planner?profile=${id}`} variant="ghost"
                                        className="px-3 py-1.5 text-sm">All</ButtonLink>} />
          {tasks.length === 0 ? <EmptyState title="No open tasks" /> : (
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id} className="px-5 py-3">
                  <Link href={`/tasks/${t.id}`} className="font-medium text-ink hover:text-accent">
                    {t.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {t.assignee_name ?? 'nobody assigned'} · {t.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {scopes.has('records:view') ? (
        <Card>
          <CardHead title="Recent documents"
                    action={<ButtonLink href={`/records?profile=${id}`} variant="ghost"
                                        className="px-3 py-1.5 text-sm">All</ButtonLink>} />
          {docs.length === 0 ? <EmptyState title="No documents you can read" /> : (
            <ul className="divide-y divide-line">
              {docs.map((d) => (
                <li key={d.id} className="px-5 py-3">
                  <Link href={`/records/${d.id}`} className="font-medium text-ink hover:text-accent">
                    {d.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {CATEGORY_LABELS[d.category]}
                    {d.document_date ? ` · ${d.document_date}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {scopes.has('medications:view') ? (
        <Card>
          <CardHead title="Medication routines"
                    action={<ButtonLink href="/medications" variant="ghost"
                                        className="px-3 py-1.5 text-sm">All</ButtonLink>} />
          {meds.length === 0 ? <EmptyState title="No active routines" /> : (
            <ul className="divide-y divide-line">
              {meds.map((m) => (
                <li key={m.id} className="px-5 py-3">
                  <p className="font-medium text-ink">
                    {m.medication_name}{m.strength ? ` ${m.strength}` : ''}
                  </p>
                  <p className="text-sm text-muted">As recorded: &ldquo;{m.dose_instruction}&rdquo;</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {scopes.has('activity:view') ? (
        <Card>
          <CardHead title="Activity" sub="Filtered to the entries your permissions cover." />
          {activity.length === 0 ? <EmptyState title="No activity recorded" /> : (
            <ol className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <p className="text-[0.95rem] text-ink">{a.summary}</p>
                  <p className="text-xs text-faint">
                    {a.actor_name ?? 'Someone'} · {relative(a.occurred_at, settings.locale)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}

      {isOwner ? (
        <>
          <Card>
            <CardHead title="Who has access to this profile"
                      sub="Withdrawing takes effect on the server immediately." />
            {grants.length === 0 ? (
              <EmptyState title="Nobody else has access"
                body="Only you can see this profile's information." />
            ) : (
              <ul className="divide-y divide-line">
                {grants.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{g.grantee_name}</p>
                      <p className="text-sm text-muted">
                        {SCOPE_LABELS[g.scope]}
                        {g.document_title ? ` · only “${g.document_title}”` : ''}
                      </p>
                      <p className="text-sm text-faint">
                        Purpose: {g.purpose}
                        {g.expires_at ? ` · expires ${g.expires_at.slice(0, 10)}` : ' · no expiry'}
                      </p>
                    </div>
                    <form action={revokeGrantAction}>
                      <input type="hidden" name="grantId" value={g.id} />
                      <input type="hidden" name="back" value={`/profiles/${id}`} />
                      <SubmitButton variant="danger" className="px-3 py-1.5 text-sm">
                        Withdraw
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line p-5">
              <Disclosure summary="Share access with someone">
                <form action={grantAccessAction} className="space-y-4">
                  <input type="hidden" name="careProfileId" value={id} />
                  <input type="hidden" name="back" value={`/profiles/${id}`} />
                  <Field label="Their email address" name="granteeEmail" required
                         hint="They must already have a CareCircle account.">
                    <Input name="granteeEmail" type="email" required />
                  </Field>
                  <fieldset className="rounded-card border border-line bg-surface-2 p-4">
                    <legend className="px-1 text-sm font-semibold text-ink">
                      What may they do? Choose only what they need.
                    </legend>
                    <div className="grid gap-x-6 sm:grid-cols-2">
                      {SCOPES.map((s) => (
                        <Checkbox key={s} name="scopes" value={s} label={SCOPE_LABELS[s]} />
                      ))}
                    </div>
                  </fieldset>
                  <Field label="Why are you sharing this?" name="purpose" required
                         hint="Recorded in the consent ledger. Future you will want to know.">
                    <Textarea name="purpose" rows={2} required maxLength={200} />
                  </Field>
                  <Field label="Expires on" name="expiresAt"
                         hint="Optional. Access stops working after this date without you doing anything.">
                    <Input name="expiresAt" type="date" />
                  </Field>
                  <SubmitButton variant="secondary">Share access</SubmitButton>
                </form>
              </Disclosure>
            </div>
          </Card>

          <Card>
            <CardHead title="Consent history"
                      sub="Append-only: every grant, expiry and withdrawal on this profile." />
            {consent.length === 0 ? <EmptyState title="Nothing shared yet" /> : (
              <ol className="divide-y divide-line">
                {consent.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Badge tone={c.action === 'granted' ? 'ok' : c.action === 'revoked' ? 'bad' : 'warn'}>
                      {c.action}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.95rem] text-ink">
                        {SCOPE_LABELS[c.scope as keyof typeof SCOPE_LABELS] ?? c.scope} — {c.grantee_name}
                      </p>
                      <p className="text-sm text-faint">
                        {c.purpose} · {formatDateTime(c.occurred_at, settings.timezone, settings.locale)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHead title="Access log for this profile"
                      sub="Security-relevant events. You are entitled to see who touched your own records." />
            {accessLog.length === 0 ? <EmptyState title="No events recorded" /> : (
              <ol className="divide-y divide-line">
                {accessLog.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                    <Badge tone={e.outcome === 'denied' ? 'bad' : 'neutral'}>{e.outcome}</Badge>
                    <span className="font-mono text-ink">{e.action}</span>
                    <span className="text-muted">{e.actor_name}</span>
                    <span className="ml-auto text-faint">
                      {formatDateTime(e.occurred_at, settings.timezone, settings.locale)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {!profile.is_self ? (
            <Card className="border-bad/30">
              <CardHead title="Remove this profile"
                        sub="Withdraws every permission on it and removes its records." />
              <form action={deleteProfileAction} className="p-5">
                <input type="hidden" name="profileId" value={id} />
                <ConfirmSubmit label="Remove profile"
                  title={`Remove ${profile.display_name}?`} confirmLabel="Yes, remove it"
                  body={<p>
                    Every permission on this profile is withdrawn and its appointments, tasks,
                    medication routines and documents stop being visible to anyone. This cannot
                    be undone.
                  </p>} />
              </form>
            </Card>
          ) : null}
        </>
      ) : (
        <Notice tone="neutral" title="This profile belongs to someone else">
          They decide what you can see and can withdraw your access at any moment. You can give up
          access yourself from Settings → Access.
        </Notice>
      )}
    </div>
  );
}
