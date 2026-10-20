import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish, no look-alikes

/**
 * Sortable, unguessable id: 8 chars of millisecond timestamp + 16 random chars.
 * Sortable ids keep timeline queries cheap; 80 bits of entropy keeps them
 * unguessable, which matters because ids appear in URLs.
 */
export function newId(prefix: string): string {
  let ts = Date.now();
  let head = '';
  for (let i = 0; i < 8; i++) {
    head = ALPHABET[ts % 32]! + head;
    ts = Math.floor(ts / 32);
  }
  const bytes = randomBytes(16);
  let tail = '';
  for (let i = 0; i < 16; i++) tail += ALPHABET[bytes[i]! % 32];
  return `${prefix}_${head}${tail}`;
}
