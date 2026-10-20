import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signInAction } from '@/app/actions/auth';
import { getUser } from '@/lib/session';
import { Card, CardHead, Field, Input, Notice } from '@/components/ui';
import { SubmitButton } from '@/components/client';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  if (await getUser()) redirect('/dashboard');
  const { error, ok } = await searchParams;

  return (
    <Card>
      <CardHead title="Sign in to CareCircle" sub="Your family's care, coordinated." />
      <form action={signInAction} className="space-y-4 p-5">
        {error ? <Notice tone="bad" title="Could not sign in">{error}</Notice> : null}
        {ok ? <Notice tone="ok">{ok}</Notice> : null}

        <Field label="Email address" name="email" required>
          <Input name="email" type="email" autoComplete="email" required autoFocus
                 inputMode="email" />
        </Field>
        <Field label="Password" name="password" required>
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>

        <p className="text-sm text-muted">
          <Link href="/recover" className="font-semibold text-accent hover:underline">
            Use a recovery code
          </Link>{' '}
          if you have forgotten your password.
        </p>
        <p className="text-sm text-muted">
          No account yet?{' '}
          <Link href="/signup" className="font-semibold text-accent hover:underline">Create one free</Link>
        </p>
      </form>
      <div className="border-t border-line px-5 py-4">
        <p className="text-sm text-muted">
          Password reset by email is not offered here because no email provider is configured.
          Your recovery code, shown once at sign-up, is the supported way back in.
        </p>
      </div>
    </Card>
  );
}
