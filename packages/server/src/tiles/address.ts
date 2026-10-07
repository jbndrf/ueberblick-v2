/**
 * Which IP addresses the tile proxy must never contact (A-033, SSRF guard): everything that is not a public unicast
 * address. IPv4-mapped (`::ffff:a.b.c.d`) and NAT64 (`64:ff9b::/96`) addresses are judged by the IPv4 address they carry.
 */
import { BlockList, isIPv4, isIPv6 } from 'node:net';

const BLOCKED = new BlockList();
const v4: readonly [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
];
for (const [net, bits] of v4) BLOCKED.addSubnet(net, bits, 'ipv4');
BLOCKED.addAddress('::', 'ipv6');
BLOCKED.addAddress('::1', 'ipv6');
BLOCKED.addSubnet('fc00::', 7, 'ipv6'); // unique local
BLOCKED.addSubnet('fe80::', 10, 'ipv6'); // link-local
BLOCKED.addSubnet('ff00::', 8, 'ipv6'); // multicast

/** The eight 16-bit groups of an IPv6 address, or `undefined` when it is not one. */
function groups(ip: string): number[] | undefined {
  let text = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (dotted !== undefined) {
    const o = dotted.split('.').map(Number);
    text = `${text.slice(0, -dotted.length)}${(((o[0] ?? 0) << 8) | (o[1] ?? 0)).toString(16)}:${(((o[2] ?? 0) << 8) | (o[3] ?? 0)).toString(16)}`;
  }
  const [head = '', tail, ...rest] = text.split('::');
  if (rest.length > 0) return undefined;
  const a = head === '' ? [] : head.split(':');
  const b = tail === undefined || tail === '' ? [] : tail.split(':');
  const fill = tail === undefined ? 0 : 8 - a.length - b.length;
  const all = [...a, ...Array<string>(Math.max(0, fill)).fill('0'), ...b].map((g) => parseInt(g, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : undefined;
}

/** The IPv4 address an IPv6 address carries (mapped or NAT64), or `undefined`. */
function embeddedV4(ip: string): string | undefined {
  const g = groups(ip);
  if (g === undefined) return undefined;
  const mapped = g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0);
  if (!mapped && !nat64) return undefined;
  const [hi = 0, lo = 0] = g.slice(6);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True when the proxy may contact this address: a public unicast IPv4 or IPv6 address. */
export function isPublicAddress(ip: string): boolean {
  if (isIPv4(ip)) return !BLOCKED.check(ip, 'ipv4');
  if (!isIPv6(ip)) return false;
  const inner = embeddedV4(ip);
  if (inner !== undefined) return isPublicAddress(inner);
  return !BLOCKED.check(ip, 'ipv6');
}
