// Minimal DER writer: just enough ASN.1 to build the X.509 certificates of the local CA (WP-941).
// The slim runtime image has no openssl, and Node has no certificate builder, so this is it.
import { isIPv4 } from 'node:net';

/** @param {number} n */
const lengthBytes = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};

/** One DER element. @param {number} tag @param {Buffer[]} parts */
export const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(body.length), body]);
};

/** @param {Buffer[]} parts */
export const sequence = (...parts) => tlv(0x30, ...parts);
/** @param {Buffer[]} parts */
export const set = (...parts) => tlv(0x31, ...parts);
/** A non-negative INTEGER from big-endian bytes. @param {Buffer} bytes */
export const integer = (bytes) => {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const trimmed = bytes.subarray(i);
  return tlv(0x02, (trimmed[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
};
/** @param {number} n */
export const smallInteger = (n) => integer(Buffer.from([n]));
/** @param {boolean} v */
export const boolean = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
/** @param {Buffer} b */
export const octetString = (b) => tlv(0x04, b);
/** @param {Buffer} b @param {number} unused */
export const bitString = (b, unused = 0) => tlv(0x03, Buffer.from([unused]), b);
/** @param {string} s */
export const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));

/** @param {string} dotted */
export const oid = (dotted) => {
  const [a = 0, b = 0, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};

/** UTCTime up to 2049, GeneralizedTime after (RFC 5280). @param {Date} d */
export const time = (d) => {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return d.getUTCFullYear() < 2050
    ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`))
    : tlv(0x18, Buffer.from(`${iso}Z`));
};

/** An explicit context tag. @param {number} n @param {Buffer[]} parts */
export const explicit = (n, ...parts) => tlv(0xa0 | n, ...parts);

/** An IPv4 or IPv6 address as raw bytes. @param {string} ip */
export function ipBytes(ip) {
  if (isIPv4(ip)) return Buffer.from(ip.split('.').map(Number));
  const [head = '', tail] = ip.split('::');
  const groups = (s) => (s === '' ? [] : s.split(':'));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const zeros = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  const out = Buffer.alloc(16);
  [...left, ...zeros, ...right].forEach((g, i) => out.writeUInt16BE(parseInt(g, 16), i * 2));
  return out;
}
