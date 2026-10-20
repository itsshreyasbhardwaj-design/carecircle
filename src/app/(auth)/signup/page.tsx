import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signUpAction } from '@/app/actions/auth';
import { getUser } from '@/lib/session';
import { Card, CardHead, Field, Input, Notice, SafetyNote } from '@/components/ui';
import { SubmitButton } from '@/components/client';
import { DEFAULT_TZ } from '@/lib/time';

export const metadata = { title: 'Create your account' };

export default async function SignupPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getUser()) redirect('/dashboard');
  const { error } = await searchParams;

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Create your CareCircle account"
          sub="Free. No card. Nothing is shared with anyone until you choose to share it."
        />
        <form action={signUpAction} className="space-y-4 p-5">
          {error ? <Notice tone="bad" title="Could not create the account">{error}</Notice> : null}

          <Field label="Your full name" name="fullName" required
                 hint="This is what your family will see next to tasks you take on.">
            <Input name="fullName" autoComplete="name" required autoFocus maxLength={120} />
          </Field>
          <Field label="Email address" name="email" required
                 hint="Used to sign in, and so relatives can share access with you.">
            <Input name="email" type="email" autoComplete="email" required inputMode="email" />
          </Field>
          <Field label="Password" name="password" required
                 hint="At least 12 characters. A short phrase you will remember beats a complicated word.">
            <Input name="password" type="password" autoComplete="new-password" required
                   minLength={12} />
          </Field>
          <input type="hidden" name="timezone" value={DEFAULT_TZ} />

          <Notice tone="neutral">
            We will show you a one-time recovery code on the next screen. Write it down — without
            an email provider configured, it is the only way to recover a forgotten password.
          </Notice>

          <SubmitButton className="w-full" pendingLabel="Creating your account…">
            Create account
          </SubmitButton>

          <p className="text-sm text-muted">
            By creating an account you accept the{' '}
            <Link href="/terms" className="font-semibold text-accent hover:underline">draft terms</Link>{' '}
            and{' '}
            <Link href="/privacy" className="font-semibold text-accent hover:underline">draft privacy policy</Link>.
            Both are clearly marked as awaiting legal review.
          </p>
          <p className="text-sm text-muted">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-accent hover:underline">Sign in</Link>
          </p>
        </form>
      </Card>
      <SafetyNote />
    </div>
  );
}
