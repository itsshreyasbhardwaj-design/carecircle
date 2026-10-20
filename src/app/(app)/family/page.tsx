import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { circlesFor } from '@/lib/circles';
import { grantsGivenBy, grantsHeldBy } from '@/lib/consent';
import { SCOPE_LABELS } from '@/lib/authz';
import { formatDate } from '@/lib/time';
import { createCircleAction, createProfileAction } from '@/app/actions/care';
import {
  Badge, ButtonLink, Card, CardHead, Checkbox, Disclosure, EmptyState, Field, Flash, Input,
  Notice, PageHead, Textarea,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Family' };

export default async function FamilyPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;

  const profiles = accessibleProfiles(user.id);
  const owned = profiles.filter((p) => p.access === 'owner');
  const shared = profiles.filter((p) => p.access === 'granted');
  const circles = circlesFor(user.id);
  const given = grantsGivenBy(user.id);
  const held = grantsHeldBy(user.id);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Family"
                sub="Care profiles, circles and who can see what. Joining a circle shares nothing by itself." />

      <Card>
        <CardHead title="Care profiles you control" sub={`${owned.length} profile(s)`} />
        {owned.length === 0 ? <EmptyState title="No profiles yet" /> : (
          <ul className="divide-y divide-line">
            {owned.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/profiles/${p.id}`} className="font-semibold text-ink hover:text-accent">
                    {p.display_name}
                  </Link>
                  <p className="text-sm text-muted">
                    {p.is_self ? 'You' : p.relationship ?? 'Family member'}
                    {p.date_of_birth ? ` · born ${formatDate(p.date_of_birth, settings.timezone, settings.locale)}` : ''}
                  </p>
                </div>
                {p.is_self ? <Badge tone="accent">Your own</Badge> : null}
                {p.profile_kind === 'proxy_pending_review'
                  ? <Badge tone="warn" title="Record features are restricted for dependent profiles">
                      Dependent — restricted
                    </Badge>
                  : null}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line p-5">
          <Disclosure summary="Add a care profile">
            <form action={createProfileAction} className="space-y-4">
              <Field label="Their name" name="displayName" required>
                <Input name="displayName" required maxLength={120} />
              </Field>
              <Field label="Relationship to you" name="relationship">
                <Input name="relationship" maxLength={60} placeholder="e.g. mother, father, spouse" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date of birth" name="dateOfBirth">
                  <Input name="dateOfBirth" type="date" />
                </Field>
                <Field label="Blood group" name="bloodGroup">
                  <Input name="bloodGroup" maxLength={10} placeholder="e.g. B+" />
                </Field>
              </div>
              <Field label="Notes" name="notes">
                <Textarea name="notes" rows={2} maxLength={2000} />
              </Field>
              <Notice tone="neutral" title="If this person can manage their own records">
                Create the profile so you can coordinate, then ask them to sign up. When they do,
                they should create their own profile and share permissions with you — that keeps
                control with the person the records belong to.
              </Notice>
              <fieldset className="rounded-card border border-warn/40 bg-warn-soft p-4">
                <legend className="px-1 text-sm font-semibold text-warn">Dependents</legend>
                <Checkbox name="isDependent"
                  label="This is a child, or an adult who cannot manage their own records"
                  hint="Such a profile is created in a restricted state. Record features stay switched off until a proxy-authorisation process has been designed and legally reviewed. Ticking a box is not consent." />
              </fieldset>
              <SubmitButton variant="secondary">Create profile</SubmitButton>
            </form>
          </Disclosure>
        </div>
      </Card>

      {shared.length > 0 ? (
        <Card>
          <CardHead title="Profiles shared with you"
                    sub="You see only what each person has granted. They can withdraw it at any time." />
          <ul className="divide-y divide-line">
            {shared.map((p) => (
              <li key={p.id} className="px-5 py-3.5">
                <Link href={`/profiles/${p.id}`} className="font-semibold text-ink hover:text-accent">
                  {p.display_name}
                </Link>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {p.scopes.map((s) => <Badge key={s} tone="accent">{SCOPE_LABELS[s]}</Badge>)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Family circles"
                  sub="A circle is a group of people who coordinate together. It grants no access on its own." />
        {circles.length === 0 ? (
          <EmptyState title="No circles yet"
            body="Create one, then invite the relatives who help with care." />
        ) : (
          <ul className="divide-y divide-line">
            {circles.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/family/${c.id}`} className="font-semibold text-ink hover:text-accent">
                    {c.name}
                  </Link>
                  <p className="text-sm text-muted">
                    {c.member_count} member{c.member_count === 1 ? '' : 's'} · you are a {c.role}
                  </p>
                </div>
                <ButtonLink href={`/family/${c.id}`} variant="secondary"
                            className="px-3 py-1.5 text-sm">Open</ButtonLink>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line p-5">
          <Disclosure summary="Create a circle">
            <form action={createCircleAction} className="flex flex-wrap items-end gap-3">
              <Field label="Circle name" name="name" required className="min-w-56 flex-1">
                <Input name="name" required maxLength={80} placeholder="e.g. Amma's care" />
              </Field>
              <SubmitButton variant="secondary">Create circle</SubmitButton>
            </form>
          </Disclosure>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHead title="Access you have given"
                    sub="Withdrawing takes effect immediately."
                    action={<ButtonLink href="/settings/access" variant="ghost"
                                        className="px-3 py-1.5 text-sm">Manage</ButtonLink>} />
          {given.length === 0 ? <EmptyState title="You have not shared anything yet" /> : (
            <ul className="divide-y divide-line">
              {given.slice(0, 8).map((g) => (
                <li key={g.id} className="px-5 py-3">
                  <p className="font-medium text-ink">{g.grantee_name}</p>
                  <p className="text-sm text-muted">
                    {g.profile_name} · {SCOPE_LABELS[g.scope]}
                    {g.document_title ? ` · only “${g.document_title}”` : ''}
                    {g.expires_at ? ` · expires ${g.expires_at.slice(0, 10)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Access you hold" sub="What others have shared with you." />
          {held.length === 0 ? <EmptyState title="Nobody has shared anything with you" /> : (
            <ul className="divide-y divide-line">
              {held.slice(0, 8).map((g) => (
                <li key={g.id} className="px-5 py-3">
                  <p className="font-medium text-ink">{g.profile_name}</p>
                  <p className="text-sm text-muted">
                    {SCOPE_LABELS[g.scope]}
                    {g.document_title ? ` · only “${g.document_title}”` : ''}
                    {g.expires_at ? ` · expires ${g.expires_at.slice(0, 10)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
