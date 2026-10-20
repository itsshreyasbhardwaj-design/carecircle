import Link from 'next/link';
import { recoverAccountAction } from '@/app/actions/auth';
import { Card, CardHead, Field, Input, Notice } from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Use a recovery code' };

export default async function RecoverPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <Card>
      <CardHead
        title="Use your recovery code"
        sub="The code shown once when you created your account."
      />
      <form action={recoverAccountAction} className="space-y-4 p-5">
        {error ? <Notice tone="bad" title="Could not reset the password">{error}</Notice> : null}

        <Notice tone="neutral">
          A recovery code works once. Using it signs out every existing session on your account.
        </Notice>

        <Field label="Email address" name="email" required>
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Recovery code" name="code" required hint="Letters and numbers, with a dash.">
          <Input name="code" required autoCapitalize="characters" spellCheck={false}
                 className="font-mono" />
        </Field>
        <Field label="New password" name="newPassword" required hint="At least 12 characters.">
          <Input name="newPassword" type="password" autoComplete="new-password" required minLength={12} />
        </Field>
        <Field label="Confirm new password" name="confirmPassword" required>
          <Input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} />
        </Field>

        <SubmitButton className="w-full" pendingLabel="Resetting…">Reset password</SubmitButton>
        <p className="text-sm text-muted">
          <Link href="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link>
        </p>
      </form>
      <div className="border-t border-line px-5 py-4 text-sm text-muted">
        <p>
          Lost the code too? On a local build you still have the database — but there is no
          password-reset back door, by design. See SECURITY.md for what an operator would need to
          do, and why that step cannot be a feature in the app.
        </p>
      </div>
    </Card>
  );
}
