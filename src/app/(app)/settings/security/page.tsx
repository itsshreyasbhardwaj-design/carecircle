import { getSettings, requireUser, currentSessionId } from '@/lib/session';
import { all } from '@/db/index';
import { formatDateTime, relative } from '@/lib/time';
import {
  changePasswordAction, revokeOtherSessionsAction, revokeSessionAction,
} from '@/app/actions/auth';
import {
  Badge, Card, CardHead, Field, Flash, Input, Notice, PageHead,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Security' };

export default async function SecuritySettingsPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;
  const thisSession = await currentSessionId();

  const sessions = all<{
    id: string; created_at: string; expires_at: string; last_seen_at: string;
    user_agent: string | null; label: string | null;
  }>(
    `SELECT id, created_at, expires_at, last_seen_at, user_agent, label
     FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_seen_at DESC`,
    user.id, new Date().toISOString(),
  );

  const recovery = all<{ recovery_code_used_at: string | null }>(
    'SELECT recovery_code_used_at FROM users WHERE id = ?', user.id,
  )[0];

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Security" sub="Your password, your sessions, and your recovery code." />

      <Card>
        <CardHead title="Change password"
                  sub="Changing it signs out every other session, which is the point." />
        <form action={changePasswordAction} className="space-y-4 p-5">
          <Field label="Current password" name="currentPassword" required>
            <Input name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" name="newPassword" required
                 hint="At least 12 characters. A short phrase is easier to remember and harder to guess.">
            <Input name="newPassword" type="password" autoComplete="new-password" required minLength={12} />
          </Field>
          <Field label="Confirm new password" name="confirmPassword" required>
            <Input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} />
          </Field>
          <SubmitButton>Change password</SubmitButton>
        </form>
      </Card>

      <Card>
        <CardHead title="Active sessions" sub={`${sessions.length} signed in`}
                  action={sessions.length > 1 ? (
                    <form action={revokeOtherSessionsAction}>
                      <SubmitButton variant="secondary">Sign out everywhere else</SubmitButton>
                    </form>
                  ) : undefined} />
        <ul className="divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">
                  {s.label ?? 'Browser session'}
                  {s.id === thisSession ? <span className="ml-2 text-sm text-accent">this device</span> : null}
                </p>
                <p className="text-sm text-muted">
                  Started {formatDateTime(s.created_at, settings.timezone, settings.locale)} ·
                  last used {relative(s.last_seen_at, settings.locale)}
                </p>
                {s.user_agent ? (
                  <p className="truncate text-xs text-faint">{s.user_agent}</p>
                ) : null}
              </div>
              {s.id === thisSession ? <Badge tone="accent">Current</Badge> : (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">
                    Sign out
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead title="Recovery code"
                  action={<Badge tone={recovery?.recovery_code_used_at ? 'warn' : 'ok'}>
                    {recovery?.recovery_code_used_at ? 'Already used' : 'Unused'}
                  </Badge>} />
        <div className="space-y-3 p-5 text-muted">
          <p>
            Your recovery code was shown once when you created the account and is stored only as a
            hash — it cannot be displayed again. It works once, and using it signs out every
            session.
          </p>
          {recovery?.recovery_code_used_at ? (
            <Notice tone="warn" title="This code has been used">
              It was redeemed on{' '}
              {formatDateTime(recovery.recovery_code_used_at, settings.timezone, settings.locale)}.
              It will not work again. If that was not you, change your password now.
            </Notice>
          ) : null}
          <Notice tone="neutral" title="Why there is no “email me a reset link”">
            No email provider is configured in this build. Offering a link that could never be
            delivered would be dishonest, and building a reset path that does not verify anything
            would be a back door. The recovery code is the honest alternative.
          </Notice>
        </div>
      </Card>

      <Card>
        <CardHead title="What protects this account" />
        <ul className="space-y-2 p-5 text-muted">
          <li>• Passwords hashed with Argon2id at OWASP-recommended parameters.</li>
          <li>• Sessions stored as peppered hashes; the raw token exists only in your cookie.</li>
          <li>• HTTP-only, same-site cookies; marked secure when served over HTTPS.</li>
          <li>• Sign-in, sign-up, password change and recovery are rate limited per account and per device.</li>
          <li>• Every document download is authorised and written to your audit log.</li>
          <li>• Sessions expire after 14 days and can be revoked individually.</li>
        </ul>
      </Card>
    </div>
  );
}
