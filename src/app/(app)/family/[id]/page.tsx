import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getSettings, requireUser } from '@/lib/session';
import {
  availabilityFor, circleProfiles, getCircle, members, pendingInvitations,
} from '@/lib/circles';
import { SCOPE_LABELS, SCOPES, isCircleCoordinator, isCircleMember } from '@/lib/authz';
import { ownedProfiles } from '@/lib/profiles';
import { formatDate, relative, todayInZone } from '@/lib/time';
import {
  createInvitationAction, leaveCircleAction, listProfileAction,
  removeMemberAction, revokeInvitationAction, setAvailabilityAction, setMemberRoleAction,
  unlistProfileAction,
} from '@/app/actions/care';
import {
  Badge, Card, CardHead, Checkbox, Disclosure, EmptyState, Field, Flash, Input, Notice, PageHead,
  Select, Textarea,
} from '@/components/ui';
import { ConfirmSubmit, CopyField, SubmitButton } from '@/components/client';

export const metadata = { title: 'Family circle' };

export default async function CirclePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; invite?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const { id } = await params;
  const sp = await searchParams;

  const circle = getCircle(id);
  if (!circle || !isCircleMember(user.id, id)) notFound();

  const isCoordinator = isCircleCoordinator(user.id, id);
  const roster = members(id);
  const listed = circleProfiles(id);
  const invites = isCoordinator ? pendingInvitations(id) : [];
  const mine = ownedProfiles(user.id);
  const unlisted = mine.filter((p) => !listed.some((l) => l.id === p.id));
  const today = todayInZone(settings.timezone);
  const availability = availabilityFor(id, today);

  // Built from the request so a copied link works on whatever host this is served from.
  const host = (await headers()).get('host') ?? 'localhost:3100';
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const inviteUrl = sp.invite ? `${proto}://${host}/invite/${encodeURIComponent(sp.invite)}` : null;

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title={circle.name}
                sub={`${roster.length} member(s) · you are a ${isCoordinator ? 'coordinator' : 'member'}`} />

      {inviteUrl ? (
        <Card className="border-accent/50">
          <CardHead title="Invitation link created"
                    sub="Shown once. Send it however you like — no email is sent by this app." />
          <div className="space-y-3 p-5">
            <CopyField value={inviteUrl} label="Invitation link" />
            <Notice tone="warn">
              Anyone with this link can accept the invitation. It expires in 7 days and can be
              revoked below. The link is not stored anywhere — only a hash of it — so it cannot be
              shown again.
            </Notice>
          </div>
        </Card>
      ) : null}

      <Notice tone="neutral" title="What this circle does and does not do">
        A circle is a roster and a shared place to coordinate. Being in it — even running it —
        grants no access to anyone&rsquo;s appointments, documents, medications or tasks. Each
        permission is granted separately by the person whose records they are.
      </Notice>

      <Card>
        <CardHead title="Members" />
        <ul className="divide-y divide-line">
          {roster.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">
                  {m.full_name}{m.user_id === user.id ? ' (you)' : ''}
                </p>
                <p className="text-sm text-muted">
                  {m.email} · joined {relative(m.joined_at, settings.locale)}
                </p>
              </div>
              <Badge tone={m.role === 'coordinator' ? 'accent' : 'neutral'}>{m.role}</Badge>
              {isCoordinator && m.user_id !== user.id ? (
                <div className="flex flex-wrap gap-2">
                  <form action={setMemberRoleAction}>
                    <input type="hidden" name="circleId" value={id} />
                    <input type="hidden" name="userId" value={m.user_id} />
                    <input type="hidden" name="role"
                           value={m.role === 'coordinator' ? 'member' : 'coordinator'} />
                    <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                      {m.role === 'coordinator' ? 'Make member' : 'Make coordinator'}
                    </SubmitButton>
                  </form>
                  <form action={removeMemberAction}>
                    <input type="hidden" name="circleId" value={id} />
                    <input type="hidden" name="userId" value={m.user_id} />
                    <ConfirmSubmit label="Remove"
                      title={`Remove ${m.full_name} from ${circle.name}?`}
                      confirmLabel="Remove and withdraw access"
                      body={<p>
                        They leave the roster, and every permission that this circle&rsquo;s listed
                        profiles granted them is withdrawn in the same action. Removing someone
                        without withdrawing their access would leave stale permissions behind.
                      </p>} />
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {isCoordinator ? (
        <Card>
          <CardHead title="Invite someone"
                    sub="Creates a link you copy and send yourself. No email provider is configured." />
          <form action={createInvitationAction} className="space-y-5 p-5">
            <input type="hidden" name="circleId" value={id} />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Their email address" name="invitedEmail"
                     hint="Optional. If set, only that email can accept the invitation.">
                <Input name="invitedEmail" type="email" />
              </Field>
              <Field label="Role in the circle" name="role" required>
                <Select name="role" required defaultValue="member">
                  <option value="member">Member — can coordinate</option>
                  <option value="coordinator">Coordinator — can also manage the roster</option>
                </Select>
              </Field>
            </div>
            <Field label="A note for them" name="message">
              <Textarea name="message" rows={2} maxLength={500}
                        placeholder="e.g. Adding you so we can share Amma's appointments" />
            </Field>

            {mine.length > 0 ? (
              <fieldset className="rounded-card border border-line bg-surface-2 p-4">
                <legend className="px-1 text-sm font-semibold text-ink">
                  Permissions to offer with this invitation
                </legend>
                <p className="text-sm text-muted">
                  Optional, and only for profiles you control. Each is applied only if they accept,
                  and re-checked against your ownership at that moment.
                </p>
                <div className="mt-3 space-y-4">
                  {mine.map((p) => (
                    <div key={p.id}>
                      <p className="text-sm font-semibold text-ink">{p.display_name}</p>
                      <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
                        {SCOPES.map((scope) => (
                          <Checkbox key={`${p.id}|${scope}`} name="offer" value={`${p.id}|${scope}`}
                                    label={SCOPE_LABELS[scope]} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 max-w-xs">
                  <Field label="Offered permissions expire on" name="offerExpiresAt"
                         hint="Optional. Useful for someone covering a single week.">
                    <Input name="offerExpiresAt" type="date" />
                  </Field>
                </div>
              </fieldset>
            ) : null}

            <SubmitButton>Create invitation link</SubmitButton>
          </form>
        </Card>
      ) : null}

      {invites.length > 0 ? (
        <Card>
          <CardHead title="Pending invitations" sub="Not yet accepted. Links expire after 7 days." />
          <ul className="divide-y divide-line">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{inv.invited_email ?? 'Anyone with the link'}</p>
                  <p className="text-sm text-muted">
                    {inv.role} · created {relative(inv.created_at, settings.locale)} ·
                    expires {relative(inv.expires_at, settings.locale)}
                  </p>
                </div>
                <form action={revokeInvitationAction}>
                  <input type="hidden" name="circleId" value={id} />
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                    Revoke
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Profiles listed in this circle"
                  sub="Listing a profile shows its name to members so they can coordinate. It shares no data." />
        {listed.length === 0 ? <EmptyState title="No profiles listed yet" /> : (
          <ul className="divide-y divide-line">
            {listed.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/profiles/${p.id}`} className="font-medium text-ink hover:text-accent">
                    {p.display_name}
                  </Link>
                  <p className="text-sm text-muted">Controlled by {p.owner_name}</p>
                </div>
                {p.owner_user_id === user.id ? (
                  <form action={unlistProfileAction}>
                    <input type="hidden" name="circleId" value={id} />
                    <input type="hidden" name="profileId" value={p.id} />
                    <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                      Unlist
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {unlisted.length > 0 ? (
          <div className="border-t border-line p-5">
            <form action={listProfileAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="circleId" value={id} />
              <Field label="List one of your profiles here" name="profileId" className="min-w-56 flex-1">
                <Select name="profileId" required>
                  {unlisted.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </Select>
              </Field>
              <SubmitButton variant="secondary">List profile</SubmitButton>
            </form>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHead title="Who is available"
                  sub={`For ${formatDate(today, settings.timezone, settings.locale)}. Helps the family avoid assigning someone who is away.`} />
        {availability.length === 0 ? <EmptyState title="Nobody has recorded availability for today" /> : (
          <ul className="divide-y divide-line">
            {availability.map((a) => (
              <li key={`${a.user_id}-${a.from_date}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{a.full_name}</p>
                  <p className="text-sm text-muted">
                    {a.from_date} to {a.to_date}{a.note ? ` · ${a.note}` : ''}
                  </p>
                </div>
                <Badge tone={a.status === 'available' ? 'ok' : a.status === 'limited' ? 'warn' : 'bad'}>
                  {a.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line p-5">
          <Disclosure summary="Record your availability">
            <form action={setAvailabilityAction} className="space-y-4">
              <input type="hidden" name="circleId" value={id} />
              <Field label="Status" name="status" required>
                <Select name="status" required defaultValue="unavailable">
                  <option value="available">Available</option>
                  <option value="limited">Limited</option>
                  <option value="unavailable">Unavailable</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From" name="fromDate" required>
                  <Input name="fromDate" type="date" required defaultValue={today} />
                </Field>
                <Field label="To" name="toDate" required>
                  <Input name="toDate" type="date" required defaultValue={today} />
                </Field>
              </div>
              <Field label="Note" name="note">
                <Input name="note" maxLength={200} placeholder="e.g. Work trip to Pune" />
              </Field>
              <SubmitButton variant="secondary">Save availability</SubmitButton>
            </form>
          </Disclosure>
        </div>
      </Card>

      <Card className="border-bad/30">
        <CardHead title="Leave this circle"
                  sub="Your own profiles are unlisted from it. Access others granted you is not affected — withdraw that from Settings → Access, or ask them to." />
        <form action={leaveCircleAction} className="p-5">
          <input type="hidden" name="circleId" value={id} />
          <ConfirmSubmit label="Leave circle" title={`Leave ${circle.name}?`}
            confirmLabel="Yes, leave"
            body={<p>You will no longer see this circle&rsquo;s roster or coordinate through it.
                     If you are the only coordinator, promote someone else first.</p>} />
        </form>
      </Card>
    </div>
  );
}
