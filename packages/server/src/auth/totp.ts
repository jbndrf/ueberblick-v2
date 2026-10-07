import { createHmac } from 'node:crypto';
import { TOTP_PARAMS } from './params';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** RFC 4226 HOTP (HMAC-SHA1, dynamic truncation). */
export function hotp(key: Uint8Array, counter: number, digits: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const off = (mac[mac.length - 1] ?? 0) & 15;
  const bin = mac.readUInt32BE(off) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpStep(timeMs: number, periodSeconds: number = TOTP_PARAMS.periodSeconds): number {
  return Math.floor(timeMs / 1000 / periodSeconds);
}

/** RFC 6238 TOTP at a moment. */
export function totpAt(
  key: Uint8Array,
  timeMs: number,
  opts: { digits?: number; periodSeconds?: number } = {},
): string {
  return hotp(key, totpStep(timeMs, opts.periodSeconds), opts.digits ?? TOTP_PARAMS.digits);
}

export function otpauthUri(secret: string, account: string): string {
  const label = encodeURIComponent(`${TOTP_PARAMS.issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${TOTP_PARAMS.issuer}&digits=${TOTP_PARAMS.digits}&period=${TOTP_PARAMS.periodSeconds}`;
}
