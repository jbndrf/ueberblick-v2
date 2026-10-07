import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compression, TileType } from 'pmtiles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openProjectDb } from '../db/open';
import { deployedVersion, loadData } from '../deploy/versions';
import { deployProject } from '../deploy/deploy-project';
import { createPackBuilder, type PackBuilder } from './builder';
import { buildLayer, layerFile } from './build';
import { withRetries, type FetchRange } from './fetch';
import { rowsOf, packTargets } from './store';
import { golden } from '../store/run/testkit';
import { fixtureArchive, must, packFile, reader, serve, tilePayload } from './testkit';
import { packTileIds } from './tile-range';

const NOW = '2026-10-02T10:00:00.000Z';
const BONN = [7.08, 50.7, 7.14, 50.75] as [number, number, number, number];
let archive: Uint8Array;
const dirs: string[] = [];

beforeAll(async () => {
  archive = await fixtureArchive(6);
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function world(
  fetchRange: FetchRange,
  file = packFile({ innen: { bounds: BONN, min_zoom: 4, max_zoom: 9 } }),
  batch = 8,
) {
  const db = openProjectDb(':memory:', 'test');
  const dir = mkdtempSync(join(tmpdir(), 'packs-'));
  dirs.push(dir);
  const r = deployProject(db, file, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  const builder: PackBuilder = createPackBuilder({
    db,
    dir,
    clock: { now: () => NOW },
    file: () => loadData(db, (deployedVersion(db) as { version: number }).version)?.file,
    fetchRange,
    batch,
  });
  return { db, dir, builder };
}

const target = (db: ReturnType<typeof openProjectDb>) =>
  packTargets(must(loadData(db, must(deployedVersion(db)).version)).file);

describe('pack build from a pmtiles source', () => {
  it('writes a valid PMTiles v3 file with exactly the tiles of bounds x zooms, capped at the archive max zoom', async () => {
    const w = world(serve(archive).fetchRange);
    expect(rowsOf(w.db, [must(target(w.db)[0]).hash]).map((r) => r.state)).toEqual(['queued']); // deploy queued it
    expect(await w.builder.drain()).toBe(1);
    const t = must(target(w.db)[0]);
    const [row] = rowsOf(w.db, [t.hash]);
    expect(row).toMatchObject({ state: 'ready', max_zoom: 6, error: null });
    const path = layerFile(w.dir, t.hash, 'basis');
    const bytes = new Uint8Array(readFileSync(path));
    expect(row?.bytes).toBe(bytes.length);
    expect(row?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const expected = packTileIds(BONN, 4, 6);
    expect(row?.tiles).toBe(expected.length);
    const pm = reader(bytes);
    const header = await pm.getHeader();
    expect(header).toMatchObject({
      specVersion: 3,
      clustered: true,
      numAddressedTiles: expected.length,
      minZoom: 4,
      maxZoom: 6,
      tileType: TileType.Png,
      tileCompression: Compression.None,
    });
    expect(await pm.getMetadata()).toEqual({ name: 'fixture' });
    // every expected tile is there with the source's bytes, and nothing else is
    const present = new Set<number>();
    for (let z = 0; z <= 7; z++)
      for (let x = 0; x < 2 ** z; x++)
        for (let y = 0; y < 2 ** z; y++) {
          const got = await pm.getZxy(z, x, y);
          if (got === undefined) continue;
          expect(new Uint8Array(got.data)).toEqual(tilePayload(z, x, y));
          present.add(z * 1e9 + x * 1e4 + y);
        }
    expect(present.size).toBe(expected.length);
  });

  it('resumes after a crash from the persisted progress: same file, no tile twice or missing', async () => {
    const big = packFile({ innen: { bounds: [-120, -60, 120, 60], min_zoom: 1, max_zoom: 6 } });
    const clean = world(serve(archive).fetchRange, big);
    await clean.builder.drain();
    const ref = must(rowsOf(clean.db, [must(target(clean.db)[0]).hash])[0]);

    const controller = new AbortController();
    const served = serve(archive);
    let tileCalls = 0;
    const stopping: FetchRange = async (url, o, l) => {
      if (served.calls.length > 0) tileCalls++; // the first call reads the header

      if (tileCalls === 3) controller.abort(); // the process "stops" after a few batches
      return served.fetchRange(url, o, l);
    };
    const w = world(stopping, big);
    await w.builder.drain(controller.signal);
    const t = must(target(w.db)[0]);
    const mid = must(rowsOf(w.db, [t.hash])[0]);
    expect(mid.state).toBe('building');
    expect(mid.tiles_done).toBeGreaterThan(0);
    expect(mid.tiles_done).toBeLessThan(mid.tiles_total);
    // a torn write: the process died after appending more than it had committed
    const spoolDir = join(w.dir, t.hash);
    appendFileSync(join(spoolDir, 'basis.part'), Buffer.from('garbage that was never committed'));
    appendFileSync(join(spoolDir, 'basis.idx'), Buffer.alloc(24, 7));

    const resumed = serve(archive);
    const builder2 = createPackBuilder({
      db: w.db,
      dir: w.dir,
      clock: { now: () => NOW },
      file: () => loadData(w.db, (deployedVersion(w.db) as { version: number }).version)?.file,
      fetchRange: resumed.fetchRange,
      batch: 8,
    });
    await builder2.drain();
    const done = must(rowsOf(w.db, [t.hash])[0]);
    expect(done.state).toBe('ready');
    expect(done.sha256).toBe(ref.sha256); // identical to the uninterrupted build
    expect(done.tiles).toBe(ref.tiles);
    expect(readdirSync(spoolDir).sort()).toEqual(['basis.pmtiles']);
  });

  it('ends in failed(reason) after the retries, and rebuild queues it again', async () => {
    let attempts = 0;
    const flaky: FetchRange = async (url, o, l) => {
      attempts++;
      if (attempts > 1) throw new Error('connection reset');
      return serve(archive).fetchRange(url, o, l);
    };
    const waits: number[] = [];
    const retrying = withRetries(flaky, {
      retries: 2,
      baseDelayMs: 10,
      sleep: async (ms) => void waits.push(ms),
    });
    const w = world(retrying);
    const failures: string[] = [];
    const builder = createPackBuilder({
      db: w.db,
      dir: w.dir,
      clock: { now: () => NOW },
      file: () => loadData(w.db, (deployedVersion(w.db) as { version: number }).version)?.file,
      fetchRange: retrying,
      onFailure: (f) => failures.push(f.reason),
    });
    await builder.drain();
    const t = must(target(w.db)[0]);
    expect(rowsOf(w.db, [t.hash])[0]).toMatchObject({ state: 'failed', error: 'connection reset' });
    expect(failures).toEqual(['connection reset']);
    expect(waits).toEqual([10, 20]); // backoff doubles
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(builder.rebuild('innen')).toBe(1);
    expect(rowsOf(w.db, [t.hash])[0]?.state).toBe('queued');
    expect(builder.rebuild('nope')).toBe(0);
  });

  it('does not build a layer whose source type is not packable', async () => {
    const w = world(serve(archive).fetchRange);
    const row = must(rowsOf(w.db, [must(target(w.db)[0]).hash])[0]);
    const served = serve(archive);
    const xyz = {
      label: { de: 'x' },
      kind: 'overlay',
      source: { type: 'wms', url: 'https://t.test/wms', layers: 'a' },
    };
    await expect(
      buildLayer(
        { db: w.db, now: () => NOW, fetchRange: served.fetchRange, dir: w.dir },
        row,
        must(target(w.db)[0]).def,
        xyz as never,
      ),
    ).rejects.toThrow('wms source cannot be packed');
    expect(served.calls).toEqual([]);
  });

  it('fails with a reason when the source has no tiles in the pack zoom range', async () => {
    const shallow = await fixtureArchive(0); // zoom 0 only: the pack starts at zoom 3
    const w = world(
      serve(shallow).fetchRange,
      packFile({ deep: { bounds: BONN, min_zoom: 3, max_zoom: 5 } }),
    );
    await w.builder.drain();
    expect(rowsOf(w.db, [must(target(w.db)[0]).hash])[0]).toMatchObject({
      state: 'failed',
      error: 'the source has no tiles in the pack area and zoom range',
    });
  });
});

describe('pack hash lifecycle across deploys', () => {
  it('a redeploy with the same hash enqueues nothing; a changed pack builds a new hash and the old one is collected', async () => {
    const w = world(serve(archive).fetchRange);
    await w.builder.drain();
    const first = must(target(w.db)[0]);
    expect(existsSync(layerFile(w.dir, first.hash, 'basis'))).toBe(true);

    // same hash: a label change is a new config version, but the pack is the same
    const relabelled = packFile({ innen: { bounds: BONN, min_zoom: 4, max_zoom: 9 } }, (f) => {
      (must(must(f.map).packs?.['innen']).label as Record<string, string>)['de'] = 'Anderer Name';
    });
    deployProject(w.db, relabelled, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
    expect(w.builder.enqueue()).toBe(0);
    expect(must(target(w.db)[0]).hash).toBe(first.hash);
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM pack_builds').get()).toEqual({ n: 1 });

    // a changed pack: new hash, queued by the deploy
    const changed = packFile({ innen: { bounds: [7.0, 50.6, 7.2, 50.8], min_zoom: 4, max_zoom: 9 } });
    deployProject(w.db, changed, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
    const second = must(target(w.db)[0]);
    expect(second.hash).not.toBe(first.hash);
    expect(rowsOf(w.db, [second.hash]).map((r) => r.state)).toEqual(['queued']);
    expect(w.builder.sweep()).toEqual([first.hash]); // nothing references the old hash any more
    expect(existsSync(join(w.dir, first.hash))).toBe(false);
    expect(rowsOf(w.db, [first.hash])).toEqual([]);
    await w.builder.drain();
    expect(rowsOf(w.db, [second.hash])[0]?.state).toBe('ready');
    expect(w.builder.sweep()).toEqual([]);
  });

  it('keeps a hash that a pinned version still references', async () => {
    const w = world(serve(archive).fetchRange);
    await w.builder.drain();
    const first = must(target(w.db)[0]);
    const changed = packFile({ innen: { bounds: [7.0, 50.6, 7.2, 50.8], min_zoom: 4, max_zoom: 9 } });
    deployProject(w.db, changed, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
    const pinning = createPackBuilder({
      db: w.db,
      dir: w.dir,
      clock: { now: () => NOW },
      file: () => loadData(w.db, (deployedVersion(w.db) as { version: number }).version)?.file,
      fetchRange: serve(archive).fetchRange,
      pinned: () => [first.hash],
    });
    expect(pinning.sweep()).toEqual([]);
    expect(existsSync(layerFile(w.dir, first.hash, 'basis'))).toBe(true);
  });
});

describe('the deploy hook that queues pack builds', () => {
  const count = (db: ReturnType<typeof openProjectDb>): number =>
    must(db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM pack_builds').get()).n;

  it('deploys a project without map.packs: ok, nothing thrown, no pack_builds rows', () => {
    const db = openProjectDb(':memory:', 'test');
    const file = structuredClone(golden('musterstadt-plain').file);
    delete file.map?.packs;
    const r = deployProject(db, file, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
    expect(r.ok).toBe(true);
    expect(count(db)).toBe(0);
  });

  it('queues one row per (pack, layer) when the project has a pack', () => {
    const file = packFile({ innen: { bounds: BONN, min_zoom: 4, max_zoom: 9 } }, (f) => {
      must(f.map).layers['zweite'] = {
        label: { de: 'Zweite' },
        kind: 'overlay',
        source: { type: 'pmtiles', url: 'https://tiles.test/zweite.pmtiles' },
      };
      must(must(f.map).packs?.['innen']).layers.push('zweite');
    });
    const w = world(serve(archive).fetchRange, file);
    const rows = rowsOf(w.db, [must(target(w.db)[0]).hash]);
    expect(rows.map((r) => [r.layer, r.state])).toEqual([
      ['basis', 'queued'],
      ['zweite', 'queued'],
    ]);
    expect(count(w.db)).toBe(2);
  });
});
