import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Everything the app writes lives under one gitignored directory. */
export const DATA_DIR = resolve(
  /*turbopackIgnore: true*/ process.env.CARECIRCLE_DATA_DIR ?? join(process.cwd(), 'data'),
);
export const DB_PATH = join(DATA_DIR, 'carecircle.db');
export const DOCS_DIR = join(DATA_DIR, 'documents');
const KEY_PATH = join(DATA_DIR, 'secrets', 'keys.json');

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Whether to believe `X-Forwarded-For`.
 *
 * Off by default, deliberately. A client can set that header freely, so trusting
 * it when the app is reachable directly would let an attacker rotate it and walk
 * straight past the per-device rate limits. Turn it on ONLY when a trusted
 * reverse proxy sets the header itself.
 */
export const TRUST_PROXY_HEADERS = process.env.CARECIRCLE_TRUST_PROXY === '1';

/** Mime types we will accept and can safely preview or stream back. */
export const ALLOWED_UPLOAD_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'text/plain': 'txt',
} as const;
export type AllowedMime = keyof typeof ALLOWED_UPLOAD_TYPES;

type Keys = { documentKey: string; sessionPepper: string; createdAt: string };
let cached: Keys | null = null;

/**
 * Local development keys, generated on first run into a gitignored file with
 * 0600 permissions. There is no key escrow: losing this file means the encrypted
 * documents cannot be recovered. See SECURITY.md.
 */
export function keys(): Keys {
  if (cached) return cached;
  const fromEnv = process.env.CARECIRCLE_DOCUMENT_KEY;
  const pepperEnv = process.env.CARECIRCLE_SESSION_PEPPER;
  if (fromEnv && pepperEnv) {
    cached = { documentKey: fromEnv, sessionPepper: pepperEnv, createdAt: 'env' };
    return cached;
  }
  mkdirSync(join(DATA_DIR, 'secrets'), { recursive: true });
  if (existsSync(KEY_PATH)) {
    cached = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as Keys;
    return cached;
  }
  const generated: Keys = {
    documentKey: randomBytes(32).toString('hex'),
    sessionPepper: randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(KEY_PATH, JSON.stringify(generated, null, 2), { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);
  cached = generated;
  return generated;
}

export function documentKey(): Buffer {
  return Buffer.from(keys().documentKey, 'hex');
}

/** Hash a client address for audit rows. Raw addresses are never stored. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(keys().sessionPepper + ip).digest('hex').slice(0, 32);
}

export function ensureDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(DOCS_DIR, { recursive: true });
}
