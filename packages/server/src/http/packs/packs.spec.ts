import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SESSION_PARTICIPANT_HEADER } from '@ueberblick/core';
import { layerFile } from '../../packs/build';
import { pinnedPackHashes } from '../../packs/pinned';
import { packTargets, rowsOf } from '../../packs/store';
import { must } from '../../packs/testkit';
import { packWorld, projectFile } from './packs.testkit';

type World = Awaited<ReturnType<typeof packWorld>>;
const manifest = async (w: World, as: string | null, headers: Record<string, string> = {}) =>
  w.handlers.manifest(w.request('', as, headers), { params: { project: 'demo' } });
const body = async (r: Response) => (await r.json()) as { packs: Record<string, unknown>[] };
const download = (
  w: World,
  as: string | null,
  hash: string,
  file: string,
  headers: Record<string, string> = {},
) =>
  w.handlers.download(w.request(`/${hash}/${file}`, as, headers), {
    params: { project: 'demo', hash, file },
  });
describe('GET /api/p/<project>/packs', () => {
  it('lists the ready packs with the A-032 fields, only the layers the caller sees', async () => {
    const w = await packWorld();
    const res = await manifest(w, 'kontrolle');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    const { packs } = await body(res);
    // kontrolle has no `verwaltung` role: `innen` shows only `basis`, `intern` is gone, `kontrolle` (layer flur) has no visible layer.
    expect(packs.map((p) => p['key'])).toEqual(['innen']);
    const innen = must(packs[0]);
    expect(Object.keys(innen).sort()).toEqual(
      ['bounds', 'built_at', 'bytes', 'hash', 'key', 'label', 'layers', 'max_zoom', 'min_zoom'].sort(),
    );
    const layers = innen['layers'] as Record<string, unknown>[];
    expect(layers.map((l) => l['layer'])).toEqual(['basis']);
    const row = must(rowsOf(w.db, [innen['hash'] as string]).find((r) => r.layer === 'basis'));
    expect(layers[0]).toEqual({
      layer: 'basis',
      tile_type: 'raster',
      url: `/api/p/demo/packs/${innen['hash']}/basis.pmtiles`,
      bytes: row.bytes,
      sha256: row.sha256,
      max_zoom: row.max_zoom,
      tiles: row.tiles,
    });
    expect(innen).toMatchObject({
      label: 'innen',
      bounds: [7.08, 50.7, 7.14, 50.75],
      min_zoom: 2,
      max_zoom: 6,
      bytes: row.bytes,
      built_at: '2026-10-02T10:00:00.000Z',
    });
  });

  it('shows a role-bound pack to that role, with all its layers', async () => {
    const w = await packWorld();
    const { packs } = await body(await manifest(w, 'verwaltung'));
    expect(packs.map((p) => p['key'])).toEqual(['innen', 'intern']);
    const innen = must(packs[0]);
    expect((innen['layers'] as { layer: string }[]).map((l) => l.layer)).toEqual(['basis', 'flur']);
    expect(innen['bytes']).toBe((innen['layers'] as { bytes: number }[]).reduce((n, l) => n + l.bytes, 0));
  });

  it('resolves the label for the request language', async () => {
    const w = await packWorld();
    const en = await body(await manifest(w, 'verwaltung', { 'accept-language': 'en' }));
    expect(en.packs.find((p) => p['key'] === 'intern')?.['label']).toBe('Internal');
    const de = await body(await manifest(w, 'verwaltung', { 'accept-language': 'de' }));
    expect(de.packs.find((p) => p['key'] === 'intern')?.['label']).toBe('Intern');
  });

  it('lists nothing while a pack is still building, and only whole packs', async () => {
    const w = await packWorld({ build: false });
    expect((await body(await manifest(w, 'verwaltung'))).packs).toEqual([]);
    await w.builder.drain();
    // one failed layer keeps the whole pack out
    w.db.prepare("UPDATE pack_builds SET state = 'failed' WHERE layer = 'flur' AND pack_key = 'innen'").run();
    expect((await body(await manifest(w, 'verwaltung'))).packs.map((p) => p['key'])).toEqual(['intern']);
  });

  it('answers 304 to a matching If-None-Match and 401 without a session', async () => {
    const w = await packWorld();
    const first = await manifest(w, 'verwaltung');
    const etag = must(first.headers.get('etag'));
    const again = await manifest(w, 'verwaltung', { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(again.headers.get('etag')).toBe(etag);
    // the other role sees another body, so another ETag
    expect((await manifest(w, 'kontrolle')).headers.get('etag')).not.toBe(etag);
    expect((await manifest(w, null)).status).toBe(401);
  });
});

describe('GET /api/p/<project>/packs/<hash>/<layer>.pmtiles', () => {
  const setup = async () => {
    const w = await packWorld();
    const hash = must(packTargets(projectFile()).find((t) => t.key === 'innen')).hash;
    const bytes = readFileSync(layerFile(w.dir, hash, 'basis'));
    return { w, hash, bytes };
  };

  it('serves the whole file with ETag, immutable cache and Accept-Ranges', async () => {
    const { w, hash, bytes } = await setup();
    const res = await download(w, 'kontrolle', hash, 'basis.pmtiles');
    expect(res.status).toBe(200);
    const sha = must(rowsOf(w.db, [hash]).find((r) => r.layer === 'basis')?.sha256);
    expect(res.headers.get('etag')).toBe(`"${sha}"`);
    expect(res.headers.get('cache-control')).toBe('private, immutable');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('serves a closed, an open and a suffix range as 206 with Content-Range', async () => {
    const { w, hash, bytes } = await setup();
    const n = bytes.length;
    const cases: [string, number, number][] = [
      ['bytes=0-99', 0, 99],
      ['bytes=100-', 100, n - 1],
      ['bytes=-50', n - 50, n - 1],
      [`bytes=${n - 10}-${n + 500}`, n - 10, n - 1],
    ];
    for (const [range, start, end] of cases) {
      const res = await download(w, 'kontrolle', hash, 'basis.pmtiles', { range });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/${n}`);
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(start, end + 1))).toBe(true);
    }
  });

  it('answers 416 for a range past the end, and the whole file for several ranges or a stale If-Range', async () => {
    const { w, hash, bytes } = await setup();
    const past = await download(w, 'kontrolle', hash, 'basis.pmtiles', { range: `bytes=${bytes.length}-` });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
    const multi = await download(w, 'kontrolle', hash, 'basis.pmtiles', { range: 'bytes=0-1,5-6' });
    expect(multi.status).toBe(200);
    expect((await multi.arrayBuffer()).byteLength).toBe(bytes.length);
    const stale = await download(w, 'kontrolle', hash, 'basis.pmtiles', {
      range: 'bytes=0-9',
      'if-range': '"old"',
    });
    expect(stale.status).toBe(200);
    const sha = must(rowsOf(w.db, [hash]).find((r) => r.layer === 'basis')?.sha256);
    const fresh = await download(w, 'kontrolle', hash, 'basis.pmtiles', {
      range: 'bytes=0-9',
      'if-range': `"${sha}"`,
    });
    expect(fresh.status).toBe(206);
  });

  it('answers 304 to If-None-Match', async () => {
    const { w, hash } = await setup();
    const sha = must(rowsOf(w.db, [hash]).find((r) => r.layer === 'basis')?.sha256);
    const res = await download(w, 'kontrolle', hash, 'basis.pmtiles', { 'if-none-match': `"${sha}"` });
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(`"${sha}"`);
  });

  it('answers 404, never 403, for a layer the caller does not see, an unknown hash or layer, and a bad path', async () => {
    const { w, hash } = await setup();
    expect((await download(w, 'kontrolle', hash, 'flur.pmtiles')).status).toBe(404);
    expect((await download(w, 'verwaltung', hash, 'flur.pmtiles')).status).toBe(200);
    expect((await download(w, 'verwaltung', 'a'.repeat(64), 'basis.pmtiles')).status).toBe(404);
    expect((await download(w, 'verwaltung', hash, 'nope.pmtiles')).status).toBe(404);
    expect((await download(w, 'verwaltung', hash, '..%2Fbasis.pmtiles')).status).toBe(404);
    expect((await download(w, 'verwaltung', 'not-a-hash', 'basis.pmtiles')).status).toBe(404);
    // the role-bound pack `intern`: invisible to kontrolle although its hash is real
    const intern = must(packTargets(projectFile()).find((t) => t.key === 'intern')).hash;
    expect((await download(w, 'kontrolle', intern, 'basis.pmtiles')).status).toBe(404);
    expect((await download(w, 'verwaltung', intern, 'basis.pmtiles')).status).toBe(200);
  });

  it('answers 401 without a session', async () => {
    const { w, hash } = await setup();
    expect((await download(w, null, hash, 'basis.pmtiles')).status).toBe(401);
  });

  it('serves nothing that is not ready', async () => {
    const w = await packWorld({ build: false });
    const hash = must(packTargets(projectFile()).find((t) => t.key === 'innen')).hash;
    expect((await download(w, 'verwaltung', hash, 'basis.pmtiles')).status).toBe(404);
  });

  it('keeps serving a hash that only a pinned version references (and 404 after the pin is gone)', async () => {
    const w = await packWorld();
    const oldHash = must(packTargets(projectFile()).find((t) => t.key === 'innen')).hash;
    w.db
      .prepare(
        `INSERT INTO features (id, type, config_version, properties, updated_seq, pinned_version) VALUES ('f1', 't', 1, '{}', 1, 1)`,
      )
      .run();
    w.deploy(projectFile([7.0, 50.6, 7.2, 50.8])); // a new hash: the old file is no longer in the deployed config
    expect(pinnedPackHashes(w.db).has(oldHash)).toBe(true);
    expect((await download(w, 'verwaltung', oldHash, 'basis.pmtiles')).status).toBe(200);
    w.db.prepare('UPDATE features SET pinned_version = NULL').run();
    expect((await download(w, 'verwaltung', oldHash, 'basis.pmtiles')).status).toBe(404);
  });
});

describe('packs under a turned session (WP-768)', () => {
  it('the manifest and a download requested as another participant are a 409', async () => {
    const w = await packWorld();
    const as = { [SESSION_PARTICIPANT_HEADER]: 'verwaltung' };
    const res = await manifest(w, 'kontrolle', as);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'session_changed' });
    const hash = '0'.repeat(64);
    expect((await download(w, 'kontrolle', hash, 'basis.pmtiles', as)).status).toBe(409);
    expect((await manifest(w, 'kontrolle', { [SESSION_PARTICIPANT_HEADER]: 'kontrolle' })).status).toBe(200);
  });
});
