import { db, one, run, tx } from '../db/index.ts';
import { hashPassword, newToken, tokenHash, verifyPassword } from './crypto.ts';
import { newId } from './ids.ts';
import { DEFAULT_TZ, nowIso } from './time.ts';
import { audit } from './audit.ts';

export type User = {
  id: string;
  email: string;
  full_name: string;
  onboarding_step: string;
  onboarding_completed_at: string | null;
};

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const SESSION_COOKIE = 'cc_session';

/**
 * Fixed-window limiter backed by the database, so it survives restarts and is
 * shared across workers.
 * ponytail: fixed window, not a sliding log. Swap for a token bucket only if
 * burst-at-window-edge abuse is actually observed.
 */
export function rateLimit(
  bucket: string, limit: number, windowMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const row = one<{ count: number; window_started_at: string; blocked_until: string | null }>(
    'SELECT count, window_started_at, blocked_until FROM rate_limits WHERE bucket = ?',
    bucket,
  );
  if (row?.blocked_until && new Date(row.blocked_until).getTime() > now) {
    return { ok: false, retryAfterMs: new Date(row.blocked_until).getTime() - now };
  }
  const windowStart = row ? new Date(row.window_started_at).getTime() : 0;
  if (!row || now - windowStart > windowMs) {
    run(
      `INSERT INTO rate_limits(bucket, count, window_started_at, blocked_until)
       VALUES(?,1,?,NULL)
       ON CONFLICT(bucket) DO UPDATE SET count=1, window_started_at=excluded.window_started_at,
         blocked_until=NULL`,
      bucket, new Date(now).toISOString(),
    );
    return { ok: true, retryAfterMs: 0 };
  }
  const next = row.count + 1;
  if (next > limit) {
    const until = new Date(now + windowMs).toISOString();
    run('UPDATE rate_limits SET count = ?, blocked_until = ? WHERE bucket = ?', next, until, bucket);
    return { ok: false, retryAfterMs: windowMs };
  }
  run('UPDATE rate_limits SET count = ? WHERE bucket = ?', next, bucket);
  return { ok: true, retryAfterMs: 0 };
}

export function clearRateLimit(bucket: string): void {
  run('DELETE FROM rate_limits WHERE bucket = ?', bucket);
}

export function findUserByEmail(email: string): (User & { password_hash: string }) | undefined {
  return one<User & { password_hash: string }>(
    `SELECT id, email, full_name, password_hash, onboarding_step, onboarding_completed_at
     FROM users WHERE email = ? AND deleted_at IS NULL`,
    email.trim().toLowerCase(),
  );
}

export type RegisterResult =
  | { ok: true; user: User; recoveryCode: string }
  | { ok: false; error: string };

export function registerUser(input: {
  email: string; password: string; fullName: string; timezone?: string;
}): RegisterResult {
  const email = input.email.trim().toLowerCase();
  if (findUserByEmail(email)) {
    return { ok: false, error: 'An account with that email already exists.' };
  }
  // Shown once at signup. Lets the user regain access without an email provider.
  const recoveryCode = `${newToken().slice(0, 6)}-${newToken().slice(0, 6)}`.toUpperCase();
  const id = newId('usr');
  const now = nowIso();
  try {
    tx((d) => {
      d.prepare(
        `INSERT INTO users
         (id, email, password_hash, full_name, recovery_code_hash, onboarding_step,
          created_at, updated_at)
         VALUES (?,?,?,?,?,'welcome',?,?)`,
      ).run(id, email, hashPassword(input.password), input.fullName.trim(),
            tokenHash(recoveryCode), now, now);
      d.prepare(
        `INSERT INTO user_settings (user_id, timezone, updated_at) VALUES (?,?,?)`,
      ).run(id, input.timezone ?? DEFAULT_TZ, now);
    });
  } catch (err) {
    if (/UNIQUE/.test((err as Error).message)) {
      return { ok: false, error: 'An account with that email already exists.' };
    }
    throw err;
  }
  audit({ actorUserId: id, action: 'account:register', outcome: 'allowed' });
  const user = one<User>(
    `SELECT id, email, full_name, onboarding_step, onboarding_completed_at
     FROM users WHERE id = ?`, id,
  )!;
  return { ok: true, user, recoveryCode };
}

/** Verifies credentials. Returns the user or null; never says which half was wrong. */
export function verifyCredentials(email: string, password: string): User | null {
  const row = findUserByEmail(email);
  if (!row) {
    // Spend comparable time so a missing account is not detectable by timing.
    verifyPassword(password, hashPassword('decoy-password-for-timing'));
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  const { password_hash: _ignored, ...user } = row;
  return user;
}

export function createSession(
  userId: string, userAgent: string | null, label?: string,
): { token: string; expiresAt: string } {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const now = nowIso();
  run(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, label)
     VALUES (?,?,?,?,?,?,?)`,
    tokenHash(token), userId, now, expiresAt, now,
    userAgent ? userAgent.slice(0, 200) : null, label ?? null,
  );
  return { token, expiresAt };
}

export function userForToken(token: string): User | null {
  const row = one<User & { session_id: string }>(
    `SELECT u.id, u.email, u.full_name, u.onboarding_step, u.onboarding_completed_at,
            s.id AS session_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.deleted_at IS NULL`,
    tokenHash(token), nowIso(),
  );
  if (!row) return null;
  // Touch at most once a minute to keep reads cheap.
  run(
    `UPDATE sessions SET last_seen_at = ?
     WHERE id = ? AND last_seen_at < ?`,
    nowIso(), row.session_id, new Date(Date.now() - 60_000).toISOString(),
  );
  const { session_id: _s, ...user } = row;
  return user;
}

export function revokeSessionByToken(token: string): void {
  run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      nowIso(), tokenHash(token));
}

export function revokeSession(userId: string, sessionId: string): void {
  run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      nowIso(), sessionId, userId);
  audit({ actorUserId: userId, action: 'session:revoke', resourceType: 'session',
          resourceId: sessionId, outcome: 'allowed' });
}

export function revokeAllSessions(userId: string, exceptSessionId?: string): number {
  const before = one<{ n: number }>(
    'SELECT count(*) n FROM sessions WHERE user_id = ? AND revoked_at IS NULL', userId,
  )!.n;
  run(
    `UPDATE sessions SET revoked_at = ?
     WHERE user_id = ? AND revoked_at IS NULL AND id <> COALESCE(?, '')`,
    nowIso(), userId, exceptSessionId ?? null,
  );
  audit({ actorUserId: userId, action: 'session:revoke_all', outcome: 'allowed',
          detail: { sessions: before } });
  return before;
}

export function changePassword(
  userId: string, currentPassword: string, newPassword: string,
): { ok: boolean; error?: string } {
  const row = one<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL', userId,
  );
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    audit({ actorUserId: userId, action: 'account:password_change', outcome: 'denied' });
    return { ok: false, error: 'Current password is incorrect.' };
  }
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      hashPassword(newPassword), nowIso(), userId);
  audit({ actorUserId: userId, action: 'account:password_change', outcome: 'allowed' });
  return { ok: true };
}

/**
 * Recovery code sign-in. Single use, and it revokes every existing session.
 * This exists because no email provider is configured; there is deliberately
 * no "email me a reset link" path that cannot actually send mail.
 */
export function redeemRecoveryCode(
  email: string, code: string, newPassword: string,
): { ok: boolean; error?: string } {
  const user = findUserByEmail(email);
  const hashed = tokenHash(code.trim().toUpperCase());
  const row = user
    ? one<{ recovery_code_hash: string | null; recovery_code_used_at: string | null }>(
        'SELECT recovery_code_hash, recovery_code_used_at FROM users WHERE id = ?', user.id)
    : undefined;
  if (!user || !row?.recovery_code_hash || row.recovery_code_used_at ||
      row.recovery_code_hash !== hashed) {
    audit({ actorUserId: user?.id ?? null, action: 'account:recovery', outcome: 'denied' });
    return { ok: false, error: 'That recovery code is not valid.' };
  }
  tx((d) => {
    d.prepare(
      `UPDATE users SET password_hash = ?, recovery_code_used_at = ?, updated_at = ? WHERE id = ?`,
    ).run(hashPassword(newPassword), nowIso(), nowIso(), user.id);
    d.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(nowIso(), user.id);
  });
  audit({ actorUserId: user.id, action: 'account:recovery', outcome: 'allowed' });
  return { ok: true };
}

/**
 * Account deletion. Removes the account, its sessions, the profiles it owns and
 * everything cascading from them, plus the encrypted document blobs.
 * Audit and consent rows are kept (they carry no health content) so a revocation
 * remains provable after the fact.
 */
export function deleteAccount(userId: string): { storagePaths: string[] } {
  const paths = db()
    .prepare(
      `SELECT v.storage_path AS p FROM document_versions v
       JOIN medical_documents d ON d.id = v.document_id
       JOIN care_profiles cp ON cp.id = d.care_profile_id
       WHERE cp.owner_user_id = ?`,
    )
    .all(userId) as { p: string }[];
  tx((d) => {
    d.prepare('UPDATE access_grants SET revoked_at = ?, revoked_by_user_id = ? WHERE grantee_user_id = ? AND revoked_at IS NULL')
      .run(nowIso(), userId, userId);
    d.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  audit({ actorUserId: userId, action: 'account:delete', outcome: 'allowed',
          detail: { documents: paths.length } });
  return { storagePaths: paths.map((r) => r.p) };
}

export function setOnboardingStep(userId: string, step: string, done = false): void {
  run(
    `UPDATE users SET onboarding_step = ?, updated_at = ?,
       onboarding_completed_at = CASE WHEN ? = 1 THEN COALESCE(onboarding_completed_at, ?) ELSE onboarding_completed_at END
     WHERE id = ?`,
    step, nowIso(), done ? 1 : 0, nowIso(), userId,
  );
}
