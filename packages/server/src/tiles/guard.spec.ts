import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './address';
import { createGuard, UpstreamRefused, type Lookup } from './guard';
import { pinnedTransport } from './pinned-fetch';
import { fakeUpstream, kit, ok, png } from './testkit';

describe('isPublicAddress: one case per refused range', () => {
  const refused: [string, string][] = [
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['10.0.0.1', '10/8'],
    ['10.255.255.255', '10/8'],
    ['172.16.0.1', '172.16/12'],
    ['172.31.255.255', '172.16/12'],
    ['192.168.1.1', '192.168/16'],
    ['169.254.169.254', 'cloud metadata'],
    ['0.0.0.0', 'this network'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'ipv6 loopback'],
    ['::', 'ipv6 unspecified'],
    ['fc00::1', 'fc00::/7'],
    ['fd12:3456::1', 'fc00::/7'],
    ['fe80::1', 'fe80::/10'],
    ['febf::1', 'fe80::/10'],
    ['::ffff:127.0.0.1', 'mapped loopback'],
    ['::ffff:10.1.2.3', 'mapped 10/8'],
    ['::ffff:a9fe:a9fe', 'mapped metadata, hex form'],
    ['64:ff9b::7f00:1', 'nat64 loopback'],
    ['not an ip', 'garbage'],
  ];
  it.each(refused)('refuses %s (%s)', (ip) => expect(isPublicAddress(ip)).toBe(false));

  const allowed = [
    '93.184.216.34',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '11.0.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ];
  it.each(allowed)('allows %s', (ip) => expect(isPublicAddress(ip)).toBe(true));
});

const never = (): never => {
  throw new Error('a request was made');
};
const guardWith = (lookup: Lookup, extra: { ownHost?: string } = {}) =>
  createGuard({ lookup, transport: never, ...extra });

describe('guard refusals make no request', () => {
  it('a literal private IP', async () => {
    const g = guardWith(never);
    await expect(g.fetch('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      refusal: 'private_address',
    });
    await expect(g.fetch('http://[::1]:8080/x')).rejects.toBeInstanceOf(UpstreamRefused);
    await expect(g.fetch('http://[::ffff:127.0.0.1]/x')).rejects.toMatchObject({
      refusal: 'private_address',
    });
  });

  it('a host name whose DNS answer is private (also when only one answer is)', async () => {
    const g = guardWith(async () => [{ address: '10.0.0.5', family: 4 }]);
    await expect(g.fetch('https://tiles.example/1/2/3.png')).rejects.toMatchObject({
      refusal: 'private_address',
    });
    const mixed = guardWith(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.0.9', family: 4 },
    ]);
    await expect(mixed.fetch('https://tiles.example/x')).rejects.toMatchObject({
      refusal: 'private_address',
    });
  });

  it('the instance itself, by name and in any case', async () => {
    const g = guardWith(async () => [{ address: '93.184.216.34', family: 4 }], {
      ownHost: 'app.example.org',
    });
    await expect(g.fetch('https://APP.example.org/api/x')).rejects.toMatchObject({ refusal: 'own_host' });
  });

  it('a relative path, another scheme, an unresolvable name', async () => {
    const g = guardWith(async () => {
      throw new Error('ENOTFOUND');
    });
    await expect(g.fetch('/relative/1.png')).rejects.toMatchObject({ refusal: 'bad_url' });
    await expect(g.fetch('file:///etc/passwd')).rejects.toMatchObject({ refusal: 'bad_url' });
    await expect(g.fetch('https://nope.example/x')).rejects.toMatchObject({ refusal: 'unresolved' });
  });
});

describe('guard: pinning and redirects', () => {
  it('connects to the validated address of the one resolution', async () => {
    const seen: string[] = [];
    let lookups = 0;
    const g = createGuard({
      lookup: async () => (lookups++, [{ address: '93.184.216.34', family: 4 }]),
      transport: async (_u, _i, pinned) => (seen.push(pinned.address), new Response('x')),
    });
    await g.fetch('https://tiles.example/a');
    expect(seen).toEqual(['93.184.216.34']);
    expect(lookups).toBe(1);
  });

  it('re-checks every redirect hop: a redirect to a private address is refused', async () => {
    const hops: string[] = [];
    const g = createGuard({
      lookup: async (host) => [
        { address: host === 'evil.example' ? '93.184.216.34' : '10.0.0.1', family: 4 },
      ],
      transport: async (u) => {
        hops.push(u);
        return new Response(null, { status: 302, headers: { location: 'http://internal.example/secret' } });
      },
    });
    await expect(g.fetch('https://evil.example/t.png')).rejects.toMatchObject({ refusal: 'private_address' });
    expect(hops).toEqual(['https://evil.example/t.png']); // the second hop was never requested
  });

  it('follows a redirect to a public host, but not forever', async () => {
    let n = 0;
    const lookup: Lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const once = createGuard({
      lookup,
      transport: async () =>
        n++ === 0
          ? new Response(null, { status: 301, headers: { location: '/next' } })
          : new Response('done'),
    });
    expect(await (await once.fetch('https://a.example/start')).text()).toBe('done');
    const loop = createGuard({
      lookup,
      transport: async () => new Response(null, { status: 302, headers: { location: '/again' } }),
    });
    await expect(loop.fetch('https://a.example/start')).rejects.toMatchObject({
      refusal: 'too_many_redirects',
    });
  });
});

describe('pinned transport', () => {
  it('connects to the pinned address and keeps the host name in the Host header', async () => {
    let host = '';
    const server = createServer((req, res) => {
      host = req.headers.host ?? '';
      res.end('hello');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await pinnedTransport(
        `http://pinned.invalid:${port}/p`,
        {},
        { address: '127.0.0.1', family: 4 },
      );
      expect(await res.text()).toBe('hello');
      expect(host).toBe(`pinned.invalid:${port}`);
    } finally {
      server.close();
    }
  });
});

describe('the tile service refuses a private layer URL without a request', () => {
  it('answers an error and never calls upstream, and does not retry', async () => {
    const up = fakeUpstream(() => ok(png('x')));
    const { service } = kit(up, { lookup: async () => [{ address: '10.1.1.1', family: 4 }] });
    const source = {
      kind: 'template',
      key: 'k',
      template: 'https://intranet.example/{z}/{x}/{y}.png',
    } as const;
    const r = await service.tile({ project: 'p', source, z: 1, x: 0, y: 0 });
    expect(r.kind).toBe('error');
    expect(up.calls).toHaveLength(0);
  });
});
