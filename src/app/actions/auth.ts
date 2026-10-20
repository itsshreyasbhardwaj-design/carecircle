'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  changePassword as changePasswordService, clearRateLimit, deleteAccount,
  rateLimit, redeemRecoveryCode, registerUser, revokeAllSessions, revokeSession,
  setOnboardingStep, verifyCredentials,
} from '@/lib/accounts';
import { endSession, requestIpHash, requireUser, startSession, currentSessionId } from '@/lib/session';
import { audit } from '@/lib/audit';
import { createProfile } from '@/lib/profiles';
import { DOCS_DIR } from '@/lib/env';
import { changePasswordSchema, loginSchema, recoverySchema, signupSchema } from '@/lib/validate';
import { bool, fail, parseOr, str, strOrNull } from './shared';

const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function signUpAction(formData: FormData): Promise<void> {
  const ip = (await requestIpHash()) ?? 'unknown';
  const gate = rateLimit(`signup:${ip}`, 10, 60 * 60 * 1000);
  if (!gate.ok) fail('/signup', 'Too many sign-up attempts from this device. Try again later.');

  const input = parseOr(signupSchema, {
    fullName: str(formData, 'fullName'),
    email: str(formData, 'email'),
    password: str(formData, 'password'),
    timezone: strOrNull(formData, 'timezone') ?? undefined,
  }, '/signup');

  const result = registerUser(input);
  if (!result.ok) fail('/signup', result.error);

  // Give every account the one profile the product assumes: their own.
  createProfile({
    ownerUserId: result.user.id, displayName: result.user.full_name,
    relationship: 'self', isSelf: true,
  });
  await startSession(result.user.id, 'Sign-up');
  // The recovery code is shown once, on the next screen, and never again.
  redirect(`/onboarding?recovery=${encodeURIComponent(result.recoveryCode)}`);
}

export async function signInAction(formData: FormData): Promise<void> {
  const input = parseOr(loginSchema, {
    email: str(formData, 'email'), password: str(formData, 'password'),
  }, '/login');
  const ip = (await requestIpHash()) ?? 'unknown';

  // Two buckets: one per account, one per device, so neither can be used to
  // lock out the other.
  for (const bucket of [`login:email:${input.email}`, `login:ip:${ip}`]) {
    const gate = rateLimit(bucket, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!gate.ok) {
      audit({ actorUserId: null, action: 'account:login', outcome: 'denied',
              ipHash: ip, detail: { reason: 'rate_limited' } });
      fail('/login', `Too many sign-in attempts. Try again in ${Math.ceil(gate.retryAfterMs / 60000)} minutes.`);
    }
  }

  const user = verifyCredentials(input.email, input.password);
  if (!user) {
    audit({ actorUserId: null, action: 'account:login', outcome: 'denied', ipHash: ip });
    fail('/login', 'That email and password do not match an account.');
  }
  clearRateLimit(`login:email:${input.email}`);
  audit({ actorUserId: user.id, action: 'account:login', outcome: 'allowed', ipHash: ip });
  await startSession(user.id);
  redirect(user.onboarding_completed_at ? '/dashboard' : '/onboarding');
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect('/');
}

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = parseOr(changePasswordSchema, {
    currentPassword: str(formData, 'currentPassword'),
    newPassword: str(formData, 'newPassword'),
    confirmPassword: str(formData, 'confirmPassword'),
  }, '/settings/security');

  const gate = rateLimit(`password:${user.id}`, 5, 15 * 60 * 1000);
  if (!gate.ok) fail('/settings/security', 'Too many attempts. Try again shortly.');

  const result = changePasswordService(user.id, input.currentPassword, input.newPassword);
  if (!result.ok) fail('/settings/security', result.error ?? 'Could not change the password.');

  // Keep this session, drop the others: a password change should evict anyone else.
  const sessionId = await currentSessionId();
  revokeAllSessions(user.id, sessionId ?? undefined);
  revalidatePath('/settings/security');
  redirect('/settings/security?ok=' + encodeURIComponent('Password changed. Other sessions were signed out.'));
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  revokeSession(user.id, str(formData, 'sessionId'));
  revalidatePath('/settings/security');
}

export async function revokeOtherSessionsAction(): Promise<void> {
  const user = await requireUser();
  const sessionId = await currentSessionId();
  revokeAllSessions(user.id, sessionId ?? undefined);
  revalidatePath('/settings/security');
}

export async function recoverAccountAction(formData: FormData): Promise<void> {
  const ip = (await requestIpHash()) ?? 'unknown';
  const gate = rateLimit(`recover:${ip}`, 6, 60 * 60 * 1000);
  if (!gate.ok) fail('/recover', 'Too many attempts. Try again later.');

  const input = parseOr(recoverySchema, {
    email: str(formData, 'email'), code: str(formData, 'code'),
    newPassword: str(formData, 'newPassword'), confirmPassword: str(formData, 'confirmPassword'),
  }, '/recover');

  const result = redeemRecoveryCode(input.email, input.code, input.newPassword);
  if (!result.ok) fail('/recover', result.error ?? 'Could not use that recovery code.');
  redirect('/login?ok=' + encodeURIComponent('Password reset. Sign in with your new password.'));
}

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (str(formData, 'confirmEmail').trim().toLowerCase() !== user.email) {
    fail('/settings/privacy', 'Type your email address exactly to confirm deletion.');
  }
  if (!bool(formData, 'understood')) {
    fail('/settings/privacy', 'Tick the confirmation box to delete your account.');
  }
  const { storagePaths } = deleteAccount(user.id);
  // Remove the encrypted blobs too; the database rows are already gone.
  for (const p of storagePaths) rmSync(join(DOCS_DIR, p), { force: true });
  await endSession();
  redirect('/?deleted=1');
}

export async function setOnboardingStepAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const step = str(formData, 'step') || 'welcome';
  const finish = bool(formData, 'finish');
  setOnboardingStep(user.id, step, finish);
  revalidatePath('/onboarding');
  if (finish) redirect('/dashboard');
  redirect(`/onboarding?step=${encodeURIComponent(step)}`);
}

export async function demoSignInAction(formData: FormData): Promise<void> {
  const email = str(formData, 'email');
  const password = str(formData, 'password');
  const user = verifyCredentials(email, password);
  if (!user) fail('/login', 'Demo account not found. Run `npm run seed:demo` first.');
  await startSession(user.id, 'Demo');
  redirect('/dashboard');
}
