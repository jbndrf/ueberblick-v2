/** A pack of an `xyz` or `preset` layer is built through the tile service: it warms the proxy cache and shares its limiter (A-033). */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PMTiles } from 'pmtiles';
import { TileType } from 'pmtiles';
import { openProjectDb } from '../db/open';
import { deployProject } from '../deploy/deploy-project';
import { deployedVersion, loadData } from '../deploy/versions';
import { createHostLimiter, type HostLimiter } from '../tiles/limiter';
import { resolveSource } from '../tiles/source';
import { fakeUpstream, kit, ok, png } from '../tiles/testkit';
import { createPackBuilder } from './builder';
import { rowsOf, packTargets } from './store';
import { must, packFile, reader } from './testkit';
import { readFileSync } from 'node:fs';
import { layerFile } from './build';
import { packTileIds } from './tile-range';
import { tileIdToZxy } from 'pmtiles';
import { createGuard, type Guard } from '../tiles/guard';
import { RangeNotFound, type FetchRange } from './fetch';
import { fixtureArchive, serve } from './testkit';

const NOW = '2026-10-02T10:00:00.000Z';
const BONN = [7.08, 50.7, 7.14, 50.75] as [number, number, number, number];
const XYZ = 'https://tiles.example/{z}/{x}/{y}.png';

function world(
  source: unknown,
  pack = { bounds: BONN, min_zoom: 10, max_zoom: 12 },
  answers: Parameters<typeof fakeUpstream>[0] = (u) => ok(png(u)),
  guard?: Guard,
  fetchRange: FetchRange = async () => {
    throw new Error('no range source');
  },
) {
  const up = fakeUpstream(answers);
  const runs: string[] = [];
  const inner = createHostLimiter({
    concurrency: 2,
    perSecond: 1e6,
    now: Date.now,
    sleep: async () => undefined,
  });
  const limiter: HostLimiter = {
    run: (host, fn) => {
      runs.push(host);
      return inner.run(host, fn);
    },
    penalize: inner.penalize,
  };
  const { service } = kit(up, { limiter });
  const file = packFile({ innen: pack }, (f) => {
    must(f.map).layers['basis'] = { label: { de: 'B' }, kind: 'base', source } as never;
  });
  const db = openProjectDb(':memory:', 'demo');
  const r = deployProject(db, file, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  const dir = mkdtempSync(join(tmpdir(), 'pk-'));
  const current = () => must(loadData(db, must(deployedVersion(db)).version)).file;
  const builder = createPackBuilder({
    db,
    dir,
    clock: { now: () => NOW },
    file: current,
    fetchRange,
    ...(guard === undefined ? {} : { guard }),
    tiles: (s, z, x, y) => service.tile({ project: 'demo', source: s, z, x, y }),
  });
  const hash = () => must(packTargets(current())[0]).hash;
  /** A second, empty pack store (new database and directory) on the same tile service and cache. */
  const again = () => {
    const db2 = openProjectDb(':memory:', 'demo');
    const r2 = deployProject(db2, file, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
    if (!r2.ok) throw new Error(JSON.stringify(r2.problems));
    const dir2 = mkdtempSync(join(tmpdir(), 'pk-'));
    const file2 = () => must(loadData(db2, must(deployedVersion(db2)).version)).file;
    const b2 = createPackBuilder({
      db: db2,
      dir: dir2,
      clock: { now: () => NOW },
      file: file2,
      fetchRange: async () => {
        throw new Error('no range source');
      },
      tiles: (s, z, x, y) => service.tile({ project: 'demo', source: s, z, x, y }),
    });
    return { builder: b2, db: db2, hash: () => must(packTargets(file2())[0]).hash };
  };
  return { up, runs, service, builder, db, dir, hash, again };
}

describe('a pack of an xyz layer', () => {
  it('builds from the proxy, writes the tiles into a valid PMTiles file, and warms the cache (acceptance 7)', async () => {
    const w = world({ type: 'xyz', url: XYZ });
    expect(await w.builder.drain()).toBe(1);
    const [row] = rowsOf(w.db, [w.hash()]);
    expect(row?.state).toBe('ready');
    const expected = packTileIds(BONN, 10, 12);
    expect(row?.tiles).toBe(expected.length);
    expect(w.up.calls).toHaveLength(expected.length);

    const file = new Uint8Array(readFileSync(layerFile(w.dir, w.hash(), 'basis')));
    const pm: PMTiles = reader(file);
    expect((await pm.getHeader()).tileType).toBe(TileType.Png);
    const [z, x, y] = tileIdToZxy(must(expected[7]));
    const stored = await pm.getZxy(z, x, y);
    expect(stored).toBeDefined();
    if (stored !== undefined)
      expect(Buffer.from(stored.data).subarray(8).toString()).toBe(
        `https://tiles.example/${z}/${x}/${y}.png`,
      );

    // The proxy now serves the whole region without one more upstream call.
    const source = resolveSource({ type: 'xyz', url: XYZ });
    if (source?.kind !== 'template') throw new Error('x');
    const t = tileIdToZxy(must(expected[5]));
    const served = await w.service.tile({ project: 'demo', source, z: t[0], x: t[1], y: t[2] });
    expect(served).toMatchObject({ kind: 'ok', cached: true });
    expect(w.up.calls).toHaveLength(expected.length);
  });

  it('a second build of the same layer makes zero upstream requests (WP-470)', async () => {
    const w = world({ type: 'xyz', url: XYZ });
    await w.builder.drain();
    const first = w.up.calls.length;
    expect(first).toBeGreaterThan(0);
    const second = w.again();
    await second.builder.drain();
    expect(rowsOf(second.db, [second.hash()])[0]?.state).toBe('ready');
    expect(w.up.calls).toHaveLength(first);
  });

  it('shares the per-host limiter with the proxy (acceptance 8)', async () => {
    const w = world({ type: 'xyz', url: XYZ });
    await w.builder.drain();
    const built = w.runs.length;
    expect(built).toBe(w.up.calls.length);
    expect(new Set(w.runs)).toEqual(new Set(['tiles.example']));
    const source = resolveSource({ type: 'xyz', url: XYZ });
    if (source?.kind !== 'template') throw new Error('x');
    await w.service.tile({ project: 'demo', source, z: 0, x: 0, y: 0 }); // a live request, not in the pack
    expect(w.runs).toHaveLength(built + 1);
    expect(w.service.limiter).toBeDefined();
  });

  it('skips a tile the source does not have and fails the layer when an upstream gives up', async () => {
    const w = world({ type: 'xyz', url: XYZ }, undefined, (u) =>
      u.includes('/10/') ? undefined : ok(png(u)),
    );
    await w.builder.drain();
    const [row] = rowsOf(w.db, [w.hash()]);
    expect(row?.state).toBe('ready');
    expect(row?.tiles).toBeLessThan(packTileIds(BONN, 10, 12).length);

    const down = world({ type: 'xyz', url: XYZ }, undefined, () => new Response('x', { status: 500 }));
    await down.builder.drain();
    expect(rowsOf(down.db, [down.hash()])[0]).toMatchObject({ state: 'failed' });
    expect(rowsOf(down.db, [down.hash()])[0]?.error).toMatch(/HTTP 500/);
  });
});

describe('a pack of the osm preset', () => {
  it('is built, at the OSM host, with the instance User-Agent', async () => {
    const w = world({ type: 'preset', preset: 'osm' }, { bounds: BONN, min_zoom: 11, max_zoom: 12 });
    await w.builder.drain();
    expect(rowsOf(w.db, [w.hash()])[0]?.state).toBe('ready');
    expect(w.up.calls[0]?.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/1[12]\//);
    expect(w.up.calls[0]?.userAgent).toMatch(/^Überblick\/4 \(\+/);
  });

  it('refuses a pack above the host cap before it fetches one tile (OSM tile usage policy)', async () => {
    const w = world(
      { type: 'preset', preset: 'osm' },
      { bounds: [6, 50, 8, 51], min_zoom: 12, max_zoom: 15 },
    );
    await w.builder.drain();
    const [row] = rowsOf(w.db, [w.hash()]);
    expect(row?.state).toBe('failed');
    expect(row?.error).toMatch(/more than the 10000 this tile host allows/);
    expect(w.up.calls).toHaveLength(0);
  });

  it('applies the same cap to an xyz layer on an OSM host', async () => {
    const w = world(
      { type: 'xyz', url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png' },
      { bounds: [6, 50, 8, 51], min_zoom: 12, max_zoom: 15 },
    );
    await w.builder.drain();
    expect(rowsOf(w.db, [w.hash()])[0]?.state).toBe('failed');
    expect(w.up.calls).toHaveLength(0);
  });
});

describe('the SSRF guard on pack layers', () => {
  it('fails a layer whose URL resolves to a private address before any request', async () => {
    const guard = createGuard({ lookup: async () => [{ address: '192.168.1.5', family: 4 }] });
    const w = world(
      { type: 'xyz', url: 'https://intranet.example/{z}/{x}/{y}.png' },
      undefined,
      undefined,
      guard,
    );
    await w.builder.drain();
    const [row] = rowsOf(w.db, [w.hash()]);
    expect(row?.state).toBe('failed');
    expect(row?.error).toMatch(/private|reserved/);
    expect(w.up.calls).toHaveLength(0);
  });

  it('a same-origin path is read through the origin path without the guard, for pmtiles and for xyz', async () => {
    const refusing = createGuard({
      ownHost: 'own.test',
      lookup: async () => [{ address: '192.168.1.5', family: 4 }],
    });
    const archive = serve(await fixtureArchive(2));
    const seen: string[] = [];
    const viaOrigin: FetchRange = (url, o, l) => {
      seen.push(url);
      return archive.fetchRange(url, o, l);
    };
    const pm = world(
      { type: 'pmtiles', url: '/tiles/a.pmtiles' },
      { bounds: [-180, -85, 180, 85], min_zoom: 0, max_zoom: 2 },
      undefined,
      refusing,
      viaOrigin,
    );
    await pm.builder.drain();
    expect(rowsOf(pm.db, [pm.hash()])[0]?.state).toBe('ready');
    expect(seen.every((u) => u === '/tiles/a.pmtiles')).toBe(true);

    seen.length = 0;
    const png1 = Buffer.from(png('x'));
    const xyz = world(
      { type: 'xyz', url: '/tiles/{z}/{x}/{y}.png' },
      { bounds: BONN, min_zoom: 10, max_zoom: 10 },
      undefined,
      refusing,
      async (url) => {
        seen.push(url);
        return new Uint8Array(png1);
      },
    );
    await xyz.builder.drain();
    expect(rowsOf(xyz.db, [xyz.hash()])[0]?.state).toBe('ready');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/^\/tiles\/10\/\d+\/\d+\.png$/);
    expect(xyz.up.calls).toHaveLength(0);
  });

  it('a path the URL parser would move to another host is absolute and guarded, and the origin is never read', async () => {
    const guard = createGuard({ lookup: async () => [{ address: '192.168.1.5', family: 4 }] });
    for (const bad of ['/\\evil.com/a.pmtiles', '/\t/evil.com/a.pmtiles', '/\n/evil.com/a.pmtiles']) {
      const seen: string[] = [];
      const w = world({ type: 'pmtiles', url: bad }, undefined, undefined, guard, async (u) => {
        seen.push(u);
        throw new Error('unreachable');
      });
      await w.builder.drain();
      expect(rowsOf(w.db, [w.hash()])[0]?.state).toBe('failed');
      expect(seen).toEqual([]);
    }
  });

  it('a self-hosted xyz tile that answers 404 is absent, like a remote one', async () => {
    let first = true;
    const png1 = Buffer.from(png('x'));
    const w = world(
      { type: 'xyz', url: '/tiles/{z}/{x}/{y}.png' },
      { bounds: BONN, min_zoom: 10, max_zoom: 10 },
      undefined,
      undefined,
      async (url) => {
        if (first) {
          first = false;
          throw new RangeNotFound(url);
        }
        return new Uint8Array(png1);
      },
    );
    await w.builder.drain();
    const row = rowsOf(w.db, [w.hash()])[0];
    expect(row?.state).toBe('ready');
    expect(row?.tiles).toBeLessThan(packTileIds(BONN, 10, 10).length);
    expect(row?.tiles).toBeGreaterThan(0);
  });

  it('a protocol-relative //host URL is absolute and guarded', async () => {
    const guard = createGuard({ lookup: async () => [{ address: '192.168.1.5', family: 4 }] });
    const w = world({ type: 'pmtiles', url: '//intranet.example/a.pmtiles' }, undefined, undefined, guard);
    await w.builder.drain();
    expect(rowsOf(w.db, [w.hash()])[0]?.state).toBe('failed');
    expect(rowsOf(w.db, [w.hash()])[0]?.error).toMatch(/not an http|bad_url|host/i);
  });
});
