import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { previewInvitation } from '@/lib/circles';
import { acceptInvitationAction } from '@/app/actions/care';
import { formatDateTime } from '@/lib/time';
import { Card, CardHead, Flash, Notice, PageHead } from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Invitation' };

export default async function InvitePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  // Signing in first is required: an invitation is accepted by a known account,
  // never by whoever happens to open the link.
  const user = await requireUser();
  const settings = await getSettings();
  const { token } = await params;
  const sp = await searchParams;
  const invite = previewInvitation(decodeURIComponent(token));

  if (!invite) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <PageHead title="This invitation cannot be used" />
        <Notice tone="bad" title="Invalid, already used, revoked, or expired">
          Invitation links last seven days and work once. Ask whoever sent it to create a new one.
        </Notice>
        <Link href="/dashboard" className="font-semibold text-accent hover:underline">
          Go to my dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Flash error={sp.error} />
      <PageHead title={`Join ${invite.circleName}`}
                sub={`${invite.inviterName} invited you as a ${invite.role}.`} />

      {invite.message ? (
        <Card>
          <CardHead title="Their message" />
          <p className="px-5 py-4 text-[0.95rem] text-ink">&ldquo;{invite.message}&rdquo;</p>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Exactly what accepting does"
                  sub="Nothing happens until you press the button." />
        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="font-semibold text-ink">You join the circle roster</p>
            <p className="text-sm text-muted">
              You will see who else is in {invite.circleName} and the names of any care profiles
              listed in it. Joining shares no medical information by itself.
            </p>
          </div>

          <div>
            <p className="font-semibold text-ink">
              {invite.offers.length > 0
                ? `You are also offered ${invite.offers.length} specific permission(s)`
                : 'No permissions are being shared with you'}
            </p>
            {invite.offers.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {invite.offers.map((o, i) => (
                  <li key={`${o.profileName}-${i}`}
                      className="rounded-card border border-line bg-surface-2 px-3 py-2.5">
                    <p className="text-[0.95rem] text-ink">
                      <strong>{o.profileName}</strong> — {o.scopeLabel}
                    </p>
                    {o.expiresAt ? (
                      <p className="text-sm text-warn">Expires {o.expiresAt.slice(0, 10)}</p>
                    ) : (
                      <p className="text-sm text-faint">No expiry date</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                You will be able to coordinate, but you will not see anyone&rsquo;s appointments,
                documents, medications or tasks until they share a permission with you deliberately.
              </p>
            )}
          </div>

          <Notice tone="neutral">
            Each offered permission is re-checked when you accept. If the person who invited you no
            longer controls one of those profiles, that offer simply does not apply.
          </Notice>

          <p className="text-sm text-faint">
            This link expires {formatDateTime(invite.expiresAt, settings.timezone, settings.locale)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-line px-5 py-4">
          <form action={acceptInvitationAction}>
            <input type="hidden" name="token" value={decodeURIComponent(token)} />
            <SubmitButton pendingLabel="Joining…">Accept and join</SubmitButton>
          </form>
          <Link href="/dashboard"
            className="cc-btn inline-flex items-center rounded-card border border-line-strong px-4 py-2.5 font-semibold text-ink">
            No thanks
          </Link>
        </div>
      </Card>

      <p className="text-sm text-muted">
        Signed in as {user.full_name} ({user.email}). If this invitation was meant for a different
        account, sign out and sign in as that person before accepting.
      </p>
    </div>
  );
}
