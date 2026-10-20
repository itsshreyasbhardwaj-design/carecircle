import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE, SESSION_TTL_MS, createSession, revokeSessionByToken, userForToken,
  type User,
} from './accounts.ts';
import { one } from '../db/index.ts';
import { DEFAULT_TZ, type Locale } from './time.ts';
import { TRUST_PROXY_HEADERS, hashIp } from './env.ts';

export type Settings = {
  locale: Locale; timezone: string; theme: 'system' | 'light' | 'dark';
  reminder_lead_minutes: number; notify_appointments: number; notify_medications: number;
  notify_tasks: number; caregiver_followups: number; reduce_motion: number;
  large_text: number; plan: 'free' | 'family'; plan_source: string;
};

/** Deduped per request, so a page with ten components does one session lookup. */
export const getUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userForToken(token);
});

export const getSettings = cache(async (): Promise<Settings> => {
  const user = await getUser();
  const fallback: Settings = {
    locale: 'en', timezone: DEFAULT_TZ, theme: 'system', reminder_lead_minutes: 120,
    notify_appointments: 1, notify_medications: 1, notify_tasks: 1, caregiver_followups: 0,
    reduce_motion: 0, large_text: 0, plan: 'free', plan_source: 'default',
  };
  if (!user) return fallback;
  return one<Settings>('SELECT * FROM user_settings WHERE user_id = ?', user.id) ?? fallback;
});

/** For pages and actions behind the app shell. Sends signed-out users to /login. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

/** For route handlers, which must answer 401 rather than redirect. */
export async function userOr401(): Promise<User | null> {
  return getUser();
}

export async function startSession(userId: string, label?: string): Promise<void> {
  const h = await headers();
  const { token, expiresAt } = createSession(userId, h.get('user-agent'), label);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) revokeSessionByToken(token);
  jar.delete(SESSION_COOKIE);
}

export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { tokenHash } = await import('./crypto.ts');
  return tokenHash(token);
}

/**
 * Hashed client address for audit rows and per-device rate limiting.
 *
 * Forwarded headers are only read when CARECIRCLE_TRUST_PROXY=1, because a
 * client can set them itself. Without a trusted proxy this returns null and the
 * callers fall back to a single shared bucket — stricter, not weaker.
 */
export async function requestIpHash(): Promise<string | null> {
  if (!TRUST_PROXY_HEADERS) return null;
  const h = await headers();
  const raw = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
  return hashIp(raw);
}
