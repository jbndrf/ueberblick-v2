import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveSource, type ProxySource } from './source';
import { fixtureArchive, serve } from '../packs/testkit';
import { fakeUpstream, filesUnder, kit, ok, png } from './testkit';

const XYZ = { type: 'xyz', url: 'https://tiles.example/{z}/{x}/{y}.png' } as const;
const template = (url: string = XYZ.url): Extract<ProxySource, { kind: 'template' }> => {
  const s = resolveSource({ type: 'xyz', url });
  if (s?.kind !== 'template') throw new Error('not a template');
  return s;
};
const text = (b: Uint8Array): string => Buffer.from(b.subarray(8)).toString();
describe('tile service: fetch through the cache', () => {
  it('fetches upstream once, caches, and serves the second request from disk (acceptance 1)', async () => {
    const up = fakeUpstream((u) => ok(png(u)));
    const { service } = kit(up);
    const a = await service.tile({ project: 'p', source: template(), z: 3, x: 4, y: 5 });
    const b = await service.tile({ project: 'p', source: template(), z: 3, x: 4, y: 5 });
    expect(up.calls).toHaveLength(1);
    expect(a).toMatchObject({ kind: 'ok', cached: false, contentType: 'image/png', ext: 'png' });
    expect(b).toMatchObject({ kind: 'ok', cached: true });
    if (a.kind === 'ok' && b.kind === 'ok') {
      expect(text(b.bytes)).toBe('https://tiles.example/3/4/5.png');
      expect(b.etag).toBe(a.etag);
    }
  });

  it('identifies itself with the User-Agent of the instance', async () => {
    const up = fakeUpstream(() => ok(png('x')));
    await kit(up).service.tile({ project: 'p', source: template(), z: 0, x: 0, y: 0 });
    expect(up.calls[0]?.userAgent).toBe('Überblick/4 (+https://test.example)');
  });

  it('does not cache a missing tile (404) or an upstream failure, and retries 5xx (acceptance 2)', async () => {
    const gone = fakeUpstream(() => undefined);
    const k1 = kit(gone);
    expect(await k1.service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 })).toEqual({
      kind: 'notfound',
    });
    expect(filesUnder(k1.root)).toEqual([]);
    expect(gone.calls).toHaveLength(1); // a 404 is final: no retry

    const broken = fakeUpstream(() => new Response('oops', { status: 503 }));
    const k2 = kit(broken);
    const r = await k2.service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 });
    expect(r.kind).toBe('error');
    expect(broken.calls).toHaveLength(4); // the first try and three retries
    expect(filesUnder(k2.root)).toEqual([]);
  });

  it('refuses an answer that is not an image (an HTML error page with status 200)', async () => {
    const up = fakeUpstream(() => new Response('<html>blocked</html>', { status: 200 }));
    const k = kit(up);
    expect((await k.service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 })).kind).toBe('error');
    expect(filesUnder(k.root)).toEqual([]);
  });

  it('does not keep what the upstream marks no-store', async () => {
    const up = fakeUpstream(() => ok(png('t'), { 'cache-control': 'no-store' }));
    const k = kit(up);
    await k.service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 });
    await k.service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 });
    expect(up.calls).toHaveLength(2);
  });

  it('honours max-age: a tile the upstream lets us keep for 10 s is fetched again after 11 s', async () => {
    let now = Date.now();
    const up = fakeUpstream(() => ok(png('t'), { 'cache-control': 'public, max-age=10' }));
    const { service } = kit(up, { now: () => now });
    const get = () => service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 });
    await get();
    now += 5_000;
    await get();
    expect(up.calls).toHaveLength(1);
    now += 6_000;
    await get();
    expect(up.calls).toHaveLength(2);
  });

  it('s-maxage wins over max-age; no-cache is fetched each time; a hit reports the remaining freshness', async () => {
    let now = Date.now();
    const up = fakeUpstream(() => ok(png('t'), { 'cache-control': 'max-age=1000, s-maxage=10' }));
    const { service } = kit(up, { now: () => now });
    const get = () => service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 });
    await get();
    now += 4_000;
    const hit = await get();
    expect(hit.kind === 'ok' && Math.round(hit.freshForS ?? -1)).toBe(6);
    now += 7_000;
    await get();
    expect(up.calls).toHaveLength(2);
    const nc = fakeUpstream(() => ok(png('t'), { 'cache-control': 'no-cache' }));
    const k = kit(nc);
    await k.service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 });
    await k.service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 });
    expect(nc.calls).toHaveLength(2);
  });

  it('honours Retry-After on a 429 before it retries', async () => {
    let n = 0;
    const up = fakeUpstream(() =>
      n++ === 0 ? new Response(null, { status: 429, headers: { 'retry-after': '2' } }) : ok(png('late')),
    );
    const sleeps: number[] = [];
    const { service, root } = kit(up, { sleep: async (ms) => void sleeps.push(ms) });
    const r = await service.tile({ project: 'p', source: template(), z: 1, x: 0, y: 0 });
    expect(r.kind).toBe('ok');
    expect(up.calls).toHaveLength(2);
    expect(sleeps.some((ms) => ms >= 1500)).toBe(true); // the limiter waited out the 2 s the host asked for
    expect(filesUnder(root)).toHaveLength(1);
  });
});

describe('tile service: cache key', () => {
  it('a changed layer source uses a new cache key (acceptance 3)', async () => {
    const up = fakeUpstream((u) => ok(png(u)));
    const { service, root } = kit(up);
    const a = template('https://one.example/{z}/{x}/{y}.png');
    const b = template('https://two.example/{z}/{x}/{y}.png');
    expect(a.key).not.toBe(b.key);
    await service.tile({ project: 'p', source: a, z: 2, x: 1, y: 1 });
    const r = await service.tile({ project: 'p', source: b, z: 2, x: 1, y: 1 });
    expect(up.calls.map((c) => c.url)).toEqual([
      'https://one.example/2/1/1.png',
      'https://two.example/2/1/1.png',
    ]);
    if (r.kind === 'ok') expect(text(r.bytes)).toBe('https://two.example/2/1/1.png');
    expect(readdirSync(`${root}/p`).sort()).toEqual([a.key, b.key].sort());
  });

  it('the same source gives the same key whatever the object key order', () => {
    expect(resolveSource({ type: 'xyz', url: 'u/{z}/{x}/{y}' })?.key).toBe(
      resolveSource({ url: 'u/{z}/{x}/{y}', type: 'xyz' } as never)?.key,
    );
  });
});

describe('tile service: size cap and atomic writes', () => {
  it('eviction keeps the cache under the cap, least recently used first (acceptance 4)', async () => {
    const up = fakeUpstream((u) => ok(png(`${u}${'.'.repeat(400)}`)));
    const k = kit(up, { limits: { cacheMaxBytes: 5_000 } });
    const get = (x: number) => k.service.tile({ project: 'p', source: template(), z: 5, x, y: 0 });
    for (let x = 0; x < 30; x++) {
      await get(x);
      expect(k.service.cache.size()).toBeLessThanOrEqual(5_000);
    }
    const kept = filesUnder(k.root);
    expect(kept.length).toBeGreaterThan(3);
    expect(kept.length).toBeLessThan(30);
    // The newest tile is still there: a second request needs no upstream call.
    const before = up.calls.length;
    await get(29);
    expect(up.calls.length).toBe(before);
    // The oldest is gone.
    await get(0);
    expect(up.calls.length).toBe(before + 1);
  });

  it('parallel requests for one tile make one upstream fetch and none reads a torn file (acceptance 5)', async () => {
    const big = png('B'.repeat(200_000));
    const up = fakeUpstream(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return ok(big);
    });
    const k = kit(up);
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        k.service.tile({ project: 'p', source: template(), z: 6, x: 7, y: 8 }),
      ),
    );
    expect(up.calls).toHaveLength(1);
    for (const r of results) {
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') expect(r.bytes.length).toBe(big.length);
    }
    // Reading while a rewrite of the stale tile happens: a reader sees the old or the new whole file.
    const files = filesUnder(k.root);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\/6\/7\/8\.png$/);
    expect(readFileSync(`${k.root}/${files[0]}`).length).toBe(big.length); // no `.tmp` is left, the file is whole
  });
});

describe('tile service: wms', () => {
  const wms = resolveSource({
    type: 'wms',
    url: 'https://wms.example/service?token=abc',
    layers: 'flur',
    version: '1.3.0',
  });
  if (wms?.kind !== 'wms') throw new Error('not wms');
  const request = { bbox: [1, 2, 3, 4], width: 256, height: 256, crs: 'EPSG:3857' } as const;

  it('asks the upstream only with the declared parameters plus bbox, size and crs (acceptance 6)', async () => {
    const up = fakeUpstream(() => ok(png('map')));
    const { service } = kit(up);
    await service.wms({ project: 'p', source: wms, request });
    const url = new URL(up.calls[0]?.url ?? '');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token: 'abc',
      service: 'WMS',
      request: 'GetMap',
      version: '1.3.0',
      layers: 'flur',
      styles: '',
      format: 'image/png',
      transparent: 'true',
      crs: 'EPSG:3857',
      bbox: '1,2,3,4',
      width: '256',
      height: '256',
    });
    await service.wms({ project: 'p', source: wms, request });
    expect(up.calls).toHaveLength(1); // cached by the hash of the normalised request
  });

  it('does not cache an XML exception document', async () => {
    const up = fakeUpstream(() => new Response('<ServiceExceptionReport/>', { status: 200 }));
    const k = kit(up);
    expect((await k.service.wms({ project: 'p', source: wms, request })).kind).toBe('error');
    expect(filesUnder(k.root)).toEqual([]);
  });
});

describe('tile service: pmtiles source', () => {
  it('reads a tile from the archive by range, caches it, and does not call the archive again', async () => {
    const served = serve(await fixtureArchive(4));
    const { service } = kit(
      fakeUpstream(() => undefined),
      { fetchRange: served.fetchRange },
    );
    const source = resolveSource({ type: 'pmtiles', url: 'https://t.example/a.pmtiles' });
    if (source?.kind !== 'pmtiles') throw new Error('x');
    const get = (z: number, x: number, y: number) => service.tile({ project: 'p', source, z, x, y });
    const a = await get(3, 1, 2);
    expect(a).toMatchObject({ kind: 'ok', cached: false, ext: 'png' });
    if (a.kind === 'ok') expect(Buffer.from(a.bytes).toString()).toBe('tile 3/1/2');
    const calls = served.calls.length;
    expect(await get(3, 1, 2)).toMatchObject({ kind: 'ok', cached: true });
    expect(served.calls.length).toBe(calls);
    expect(await get(6, 1, 2)).toEqual({ kind: 'notfound' }); // the archive stops at zoom 4
  });
});
