import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from './helpers.ts';
import {
  changePassword, createSession, deleteAccount, findUserByEmail, rateLimit,
  redeemRecoveryCode, registerUser, revokeAllSessions, revokeSessionByToken, userForToken,
  verifyCredentials,
} from '../src/lib/accounts.ts';
import { hashPassword, verifyPassword } from '../src/lib/crypto.ts';
import { all, one } from '../src/db/index.ts';

const PASSWORD = 'correct horse battery staple';

describe('accounts and sessions', () => {
  beforeEach(resetDb);

  it('registers a user and stores no plaintext password', () => {
    const result = registerUser({ email: 'A.Person@Example.TEST', password: PASSWORD, fullName: 'A Person' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.email).toBe('a.person@example.test'); // normalised
    const row = one<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = ?', result.user.id,
    );
    expect(row?.password_hash).not.toContain(PASSWORD);
    expect(row?.password_hash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects a duplicate email regardless of case', () => {
    registerUser({ email: 'dup@example.test', password: PASSWORD, fullName: 'One' });
    const second = registerUser({ email: 'DUP@example.test', password: PASSWORD, fullName: 'Two' });
    expect(second.ok).toBe(false);
  });

  it('verifies the right password and refuses the wrong one', () => {
    registerUser({ email: 'login@example.test', password: PASSWORD, fullName: 'Login' });
    expect(verifyCredentials('login@example.test', PASSWORD)).not.toBeNull();
    expect(verifyCredentials('login@example.test', 'wrong password here')).toBeNull();
    expect(verifyCredentials('nobody@example.test', PASSWORD)).toBeNull();
  });

  it('hashes with a per-password salt', () => {
    const a = hashPassword(PASSWORD);
    const b = hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    expect(verifyPassword(PASSWORD, a)).toBe(true);
    expect(verifyPassword(PASSWORD, b)).toBe(true);
    expect(verifyPassword('something else entirely', a)).toBe(false);
  });

  it('does not store the raw session token', () => {
    const user = registerUser({ email: 's@example.test', password: PASSWORD, fullName: 'S' });
    if (!user.ok) throw new Error('setup');
    const { token } = createSession(user.user.id, 'test-agent');
    const stored = all<{ id: string }>('SELECT id FROM sessions');
    expect(stored.some((s) => s.id === token)).toBe(false);
    expect(userForToken(token)?.id).toBe(user.user.id);
  });

  it('refuses an expired or revoked session', () => {
    const user = registerUser({ email: 'exp@example.test', password: PASSWORD, fullName: 'E' });
    if (!user.ok) throw new Error('setup');
    const { token } = createSession(user.user.id, null);
    expect(userForToken(token)).not.toBeNull();

    revokeSessionByToken(token);
    expect(userForToken(token)).toBeNull();

    const { token: second } = createSession(user.user.id, null);
    one('UPDATE sessions SET expires_at = ? WHERE user_id = ?',
        new Date(Date.now() - 1000).toISOString(), user.user.id);
    expect(userForToken(second)).toBeNull();
  });

  it('rejects a made-up token', () => {
    expect(userForToken('not-a-real-token')).toBeNull();
  });

  it('rate limits after the configured number of attempts', () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit('test:bucket', 5, 60_000).ok).toBe(true);
    }
    const blocked = rateLimit('test:bucket', 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('changes a password only with the current one', () => {
    const user = registerUser({ email: 'pw@example.test', password: PASSWORD, fullName: 'P' });
    if (!user.ok) throw new Error('setup');
    expect(changePassword(user.user.id, 'wrong', 'a brand new passphrase').ok).toBe(false);
    expect(changePassword(user.user.id, PASSWORD, 'a brand new passphrase').ok).toBe(true);
    expect(verifyCredentials('pw@example.test', 'a brand new passphrase')).not.toBeNull();
    expect(verifyCredentials('pw@example.test', PASSWORD)).toBeNull();
  });

  it('revokes every other session but keeps the one asked for', () => {
    const user = registerUser({ email: 'multi@example.test', password: PASSWORD, fullName: 'M' });
    if (!user.ok) throw new Error('setup');
    const keep = createSession(user.user.id, 'keep');
    createSession(user.user.id, 'drop-1');
    createSession(user.user.id, 'drop-2');
    const kept = one<{ id: string }>('SELECT id FROM sessions WHERE user_agent = ?', 'keep')!;
    revokeAllSessions(user.user.id, kept.id);
    expect(userForToken(keep.token)).not.toBeNull();
    const active = all('SELECT 1 FROM sessions WHERE revoked_at IS NULL');
    expect(active.length).toBe(1);
  });

  it('accepts a recovery code once and then never again', () => {
    const result = registerUser({ email: 'rec@example.test', password: PASSWORD, fullName: 'R' });
    if (!result.ok) throw new Error('setup');
    const code = result.recoveryCode;
    createSession(result.user.id, 'will-be-revoked');

    expect(redeemRecoveryCode('rec@example.test', 'WRONG-CODE', 'new passphrase here').ok).toBe(false);
    expect(redeemRecoveryCode('rec@example.test', code, 'new passphrase here').ok).toBe(true);
    expect(verifyCredentials('rec@example.test', 'new passphrase here')).not.toBeNull();
    // Single use, and every session was dropped.
    expect(redeemRecoveryCode('rec@example.test', code, 'another passphrase').ok).toBe(false);
    expect(all('SELECT 1 FROM sessions WHERE revoked_at IS NULL').length).toBe(0);
  });

  it('deletes an account and keeps the consent trail', () => {
    const user = registerUser({ email: 'gone@example.test', password: PASSWORD, fullName: 'G' });
    if (!user.ok) throw new Error('setup');
    deleteAccount(user.user.id);
    expect(findUserByEmail('gone@example.test')).toBeUndefined();
    // Audit rows survive on purpose: a deletion should remain provable.
    const audits = all('SELECT 1 FROM audit_events WHERE action = ?', 'account:delete');
    expect(audits.length).toBe(1);
  });
});
