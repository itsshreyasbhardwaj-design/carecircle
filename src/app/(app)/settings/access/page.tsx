import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { ownedProfiles } from '@/lib/profiles';
import { grantsGivenBy, grantsHeldBy } from '@/lib/consent';
import { SCOPE_LABELS, SCOPES } from '@/lib/authz';
import { formatDateTime } from '@/lib/time';
import { grantAccessAction, revokeGrantAction } from '@/app/actions/care';
import {
  Card, CardHead, Checkbox, EmptyState, Field, Flash, Input, Notice, PageHead, Select,
  Textarea,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Access' };

export default async function AccessSettingsPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;

  const profiles = ownedProfiles(user.id);
  const given = grantsGivenBy(user.id);
  const held = grantsHeldBy(user.id);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Access"
                sub="Everything you have shared, and everything shared with you. Withdrawal is immediate." />

      <Notice tone="neutral" title="How permissions work here">
        Each permission is granted on one profile, to one person, for a stated purpose, optionally
        until a date. Nothing is implied by family relationship or circle membership. &ldquo;Add
        documents&rdquo; deliberately does not include reading existing ones.
      </Notice>

      <Card>
        <CardHead title="Access you have given" sub={`${given.length} active grant(s)`} />
        {given.length === 0 ? (
          <EmptyState title="You have not shared anything"
            body="Nobody else can see any of your care profiles' information." />
        ) : (
          <ul className="divide-y divide-line">
            {given.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{g.grantee_name}</p>
                  <p className="text-sm text-muted">{g.grantee_email}</p>
                  <p className="mt-1 text-[0.95rem] text-ink">
                    <Link href={`/profiles/${g.care_profile_id}`} className="font-medium text-accent hover:underline">
                      {g.profile_name}
                    </Link>
                    {' — '}{SCOPE_LABELS[g.scope]}
                  </p>
                  {g.document_title ? (
                    <p className="text-sm text-warn">Limited to one document: “{g.document_title}”</p>
                  ) : null}
                  <p className="text-sm text-faint">
                    Purpose: {g.purpose} · shared {formatDateTime(g.created_at, settings.timezone, settings.locale)}
                    {g.expires_at ? ` · expires ${g.expires_at.slice(0, 10)}` : ' · no expiry'}
                  </p>
                </div>
                <form action={revokeGrantAction}>
                  <input type="hidden" name="grantId" value={g.id} />
                  <input type="hidden" name="back" value="/settings/access" />
                  <SubmitButton variant="danger" className="px-3 py-1.5 text-sm">Withdraw</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {profiles.length > 0 ? (
        <Card>
          <CardHead title="Share access" sub="Choose only what the person actually needs." />
          <form action={grantAccessAction} className="space-y-5 p-5">
            <input type="hidden" name="back" value="/settings/access" />
            <Field label="Whose information?" name="careProfileId" required>
              <Select name="careProfileId" required>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </Select>
            </Field>
            <Field label="Their email address" name="granteeEmail" required
                   hint="They need a CareCircle account. Ask them to sign up first if they do not have one.">
              <Input name="granteeEmail" type="email" required />
            </Field>
            <fieldset className="rounded-card border border-line bg-surface-2 p-4">
              <legend className="px-1 text-sm font-semibold text-ink">What may they do?</legend>
              <div className="grid gap-x-6 sm:grid-cols-2">
                {SCOPES.map((s) => <Checkbox key={s} name="scopes" value={s} label={SCOPE_LABELS[s]} />)}
              </div>
            </fieldset>
            <Field label="Why?" name="purpose" required
                   hint="Written into the consent ledger so the reason survives.">
              <Textarea name="purpose" rows={2} required maxLength={200} />
            </Field>
            <Field label="Expires on" name="expiresAt"
                   hint="Optional. Access stops working after this date with no action from you.">
              <Input name="expiresAt" type="date" />
            </Field>
            <SubmitButton>Share access</SubmitButton>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Access you hold"
                  sub="You can hand any of these back. The owner can also withdraw them at any time." />
        {held.length === 0 ? (
          <EmptyState title="Nobody has shared anything with you" />
        ) : (
          <ul className="divide-y divide-line">
            {held.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    <Link href={`/profiles/${g.care_profile_id}`} className="hover:text-accent">
                      {g.profile_name}
                    </Link>
                  </p>
                  <p className="text-[0.95rem] text-ink">{SCOPE_LABELS[g.scope]}</p>
                  {g.document_title ? (
                    <p className="text-sm text-warn">Only “{g.document_title}”</p>
                  ) : null}
                  <p className="text-sm text-faint">
                    Purpose: {g.purpose}
                    {g.expires_at ? ` · expires ${g.expires_at.slice(0, 10)}` : ''}
                  </p>
                </div>
                <form action={revokeGrantAction}>
                  <input type="hidden" name="grantId" value={g.id} />
                  <input type="hidden" name="back" value="/settings/access" />
                  <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                    Give this up
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
