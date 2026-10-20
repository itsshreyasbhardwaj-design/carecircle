import {
  createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual,
} from 'node:crypto';
import { argon2id } from '@noble/hashes/argon2';
import { documentKey, keys } from './env.ts';

// OWASP-recommended argon2id floor (19 MiB, 2 iterations, 1 lane).
const ARGON = { m: 19456, t: 2, p: 1, dkLen: 32 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = argon2id(password, salt, ARGON);
  return [
    '$argon2id$v=19',
    `m=${ARGON.m},t=${ARGON.t},p=${ARGON.p}`,
    salt.toString('base64'),
    Buffer.from(hash).toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$').filter(Boolean);
  // [argon2id, v=19, m=..,t=..,p=.., salt, hash]
  if (parts.length !== 5 || parts[0] !== 'argon2id') return false;
  const params = Object.fromEntries(
    parts[2]!.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k!, Number(v)];
    }),
  ) as { m: number; t: number; p: number };
  const salt = Buffer.from(parts[3]!, 'base64');
  const expected = Buffer.from(parts[4]!, 'base64');
  let actual: Buffer;
  try {
    actual = Buffer.from(argon2id(password, salt, { ...params, dkLen: expected.length }));
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** URL-safe secret for sessions and invitation links. 256 bits. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored only as peppered hashes, so a database leak is not a key leak. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(keys().sessionPepper).update(token).digest('hex');
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export type Encrypted = { ciphertext: Buffer; iv: string; tag: string };

/** AES-256-GCM. Documents are never written to disk in plaintext. */
export function encryptBuffer(plain: Buffer): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', documentKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}

/** Throws if the ciphertext or tag was tampered with. Callers must not swallow it. */
export function decryptBuffer(ciphertext: Buffer, iv: string, tag: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', documentKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Constant-time compare for opaque tokens supplied by a client. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
