/** Truncates a client address for logs: IPv4 to /24, IPv6 to /48 (docs/process/logging.md). Unparseable input becomes `invalid`. */
export function truncateIp(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const p = v4.slice(1).map(Number);
    return p.some((n) => n > 255) ? 'invalid' : `${p[0]}.${p[1]}.${p[2]}.0/24`;
  }
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (mapped?.[1]) return truncateIp(mapped[1]);
  const groups = expandV6(ip);
  return groups
    ? `${groups
        .slice(0, 3)
        .map((g) => g.toString(16))
        .join(':')}::/48`
    : 'invalid';
}

function expandV6(ip: string): number[] | undefined {
  if (!/^[0-9a-f:]+$/i.test(ip) || (ip.match(/::/g) ?? []).length > 1) return undefined;
  const [head = '', tail] = ip.split('::');
  const h = head === '' ? [] : head.split(':');
  const t = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - h.length - t.length;
  if (tail === undefined ? h.length !== 8 : missing < 1) return undefined;
  const all = tail === undefined ? h : [...h, ...Array<string>(missing).fill('0'), ...t];
  const nums = all.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? undefined : nums;
}
