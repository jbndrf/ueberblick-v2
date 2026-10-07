import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex of a high-entropy secret. Tokens and session ids are 256-bit random, so a fast hash is right. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** The one comparison for secrets, hashes and codes. Length differences are hashed away first. */
export function safeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/** `chars` symbols from `alphabet` (length must divide 256, so no modulo bias), cut into groups by `-`. */
export function typeableToken(alphabet: string, chars: number, group: number): string {
  const out: string[] = [];
  for (const b of randomBytes(chars)) out.push(alphabet[b % alphabet.length] as string);
  const groups: string[] = [];
  for (let i = 0; i < chars; i += group) groups.push(out.slice(i, i + group).join(''));
  return groups.join('-');
}
