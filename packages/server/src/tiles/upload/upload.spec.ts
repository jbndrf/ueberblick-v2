import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tileUploadMax } from '@ueberblick/core';
import type { PMTiles } from 'pmtiles';
import { fixtureArchive, reader, tilePayload } from '../../packs/testkit';
import { image, kit, mbtiles, once, pyramid, read, upload, zipOf, type Kit } from './testkit';

let k: Kit;
afterEach(() => k.cleanup());

const tileOf = async (p: PMTiles, z: number, x: number, y: number): Promise<string | undefined> => {
  const t = await p.getZxy(z, x, y);
  return t === undefined ? undefined : Buffer.from(t.data).toString('latin1');
};
const archive = (id: string | undefined): Uint8Array => read(k.uploads.archivePath('demo', id ?? '') ?? '');

describe('MBTiles', () => {
  it('becomes one PMTiles archive: the TMS rows are flipped and the tile bytes are equal', async () => {
    k = kit();
    const tiles = pyramid(3);
    mbtiles(join(k.dir, 'a.mbtiles'), tiles, { name: 'Luftbild', bounds: '5,45,15,55' });
    const job = await upload(k, 'mbtiles', read(join(k.dir, 'a.mbtiles')), { format: 'png', chunk: 3000 });
    expect(job?.state).toBe('done');
    expect(job?.result).toMatchObject({
      format: 'png',
      minZoom: 0,
      maxZoom: 3,
      tiles: tiles.length,
      bounds: [5, 45, 15, 55],
    });
    expect(job?.result?.url).toBe(`/api/p/demo/tiles/archives/${job?.id}.pmtiles`);
    const p = reader(archive(job?.id));
    for (const t of tiles)
      expect(await tileOf(p, t.z, t.x, t.y)).toBe(Buffer.from(t.data).toString('latin1'));
  });

  it('refuses a corrupt file, a mismatching format and non-image tiles with typed reasons', async () => {
    k = kit();
    expect((await upload(k, 'mbtiles', new Uint8Array(500).fill(7)))?.error?.reason).toBe('corrupt');
    mbtiles(join(k.dir, 'b.mbtiles'), [{ z: 0, x: 0, y: 0, data: image('x') }]);
    const b = read(join(k.dir, 'b.mbtiles'));
    expect((await upload(k, 'mbtiles', b, { format: 'jpg' }))?.error?.reason).toBe('wrong_format');
    mbtiles(join(k.dir, 'c.mbtiles'), [{ z: 0, x: 0, y: 0, data: Buffer.from('<html>') }]);
    expect((await upload(k, 'mbtiles', read(join(k.dir, 'c.mbtiles'))))?.error?.reason).toBe('not_tiles');
    const damaged = Uint8Array.from(b);
    damaged.fill(0xee, 4096);
    expect((await upload(k, 'mbtiles', damaged))?.error?.reason).toBe('corrupt');
  });
});

describe('ZIP of XYZ tiles', () => {
  it('becomes one PMTiles archive with equal tile bytes, also inside a wrapper folder', async () => {
    k = kit();
    const tiles = pyramid(3);
    const entries = Object.fromEntries(tiles.map((t) => [`karte/${t.z}/${t.x}/${t.y}.png`, t.data] as const));
    entries['__MACOSX/readme.txt'] = Buffer.from('ignored');
    const job = await upload(k, 'zip', await zipOf(entries), { format: 'png', chunk: 2500 });
    expect(job?.state).toBe('done');
    expect(job?.result).toMatchObject({ format: 'png', minZoom: 0, maxZoom: 3, tiles: tiles.length });
    const p = reader(archive(job?.id));
    for (const t of tiles)
      expect(await tileOf(p, t.z, t.x, t.y)).toBe(Buffer.from(t.data).toString('latin1'));
  });

  it('refuses a ZIP without tiles, a mixed or mismatching format and a damaged file', async () => {
    k = kit();
    const none = await upload(k, 'zip', await zipOf({ 'notes.txt': Buffer.from('hi') }));
    expect(none?.error?.reason).toBe('not_tiles');
    const mixed = await zipOf({ '0/0/0.png': image('a'), '1/0/0.jpg': image('b', 'jpg') });
    expect((await upload(k, 'zip', mixed))?.error?.reason).toBe('wrong_format');
    const png = await zipOf({ '0/0/0.png': image('a') });
    expect((await upload(k, 'zip', png, { format: 'webp' }))?.error?.reason).toBe('wrong_format');
    expect((await upload(k, 'zip', new Uint8Array(200).fill(3)))?.error?.reason).toBe('corrupt');
    const fake = await zipOf({ '0/0/0.png': Buffer.from('<html>not an image</html>') });
    expect((await upload(k, 'zip', fake))?.error?.reason).toBe('not_tiles');
  });

  it('refuses a zip bomb: a tile that inflates far past the tile limit, with a typed reason', async () => {
    k = kit();
    const bomb = Buffer.concat([image('x'), Buffer.alloc(tileUploadMax('tile_bytes') * 3)]);
    const zip = await zipOf({ '0/0/0.png': bomb, '1/0/0.png': image('y') });
    expect(zip.length).toBeLessThan(tileUploadMax('tile_bytes') / 100);
    const job = await upload(k, 'zip', zip);
    expect(job?.state).toBe('failed');
    expect(job?.error?.reason).toBe('zip_bomb');
    expect(readdirSync(join(k.dir, 'tiles', 'demo')).filter((f) => f.endsWith('.pmtiles'))).toEqual([]);
  });
});

describe('PMTiles', () => {
  it('is validated and kept as it is', async () => {
    k = kit();
    const bytes = await fixtureArchive(2);
    const job = await upload(k, 'pmtiles', bytes, { chunk: 100 });
    expect(job?.state).toBe('done');
    expect(job?.result).toMatchObject({
      format: 'png',
      minZoom: 0,
      maxZoom: 2,
      tiles: 21,
      bounds: [-180, -85, 180, 85],
    });
    const stored = archive(job?.id);
    expect(Buffer.from(stored).equals(Buffer.from(bytes))).toBe(true);
    const t = await reader(stored).getZxy(2, 1, 3);
    expect(Buffer.from(new Uint8Array(t?.data ?? new ArrayBuffer(0))).toString()).toBe(
      Buffer.from(tilePayload(2, 1, 3)).toString(),
    );
  });

  it('refuses a file that is not a PMTiles archive and one that is cut off', async () => {
    k = kit();
    expect((await upload(k, 'pmtiles', new Uint8Array(300).fill(1)))?.error?.reason).toBe('corrupt');
    const bytes = await fixtureArchive(3);
    expect((await upload(k, 'pmtiles', bytes.slice(0, bytes.length - 40)))?.error?.reason).toBe('corrupt');
  });
});

describe('chunked upload', () => {
  it('resumes after a missing chunk: the next chunk must follow the bytes received so far', async () => {
    k = kit();
    const bytes = await fixtureArchive(2);
    const job = k.uploads.start('demo', { kind: 'pmtiles', name: 'x', size: bytes.length });
    await k.uploads.chunk('demo', job.id, 0, once(bytes.subarray(0, 100)));
    await expect(k.uploads.chunk('demo', job.id, 200, once(bytes.subarray(200, 300)))).rejects.toMatchObject({
      reason: 'bad_chunk',
    });
    expect(k.uploads.status('demo', job.id)?.received).toBe(100);
    expect(() => k.uploads.finish('demo', job.id)).toThrow(/arrived/);
    await k.uploads.chunk('demo', job.id, 100, once(bytes.subarray(100)));
    k.uploads.finish('demo', job.id);
    await k.uploads.idle();
    expect(k.uploads.status('demo', job.id)?.state).toBe('done');
  });

  it('a chunk that fails halfway leaves the received count where it was', async () => {
    k = kit();
    const job = k.uploads.start('demo', { kind: 'pmtiles', name: 'x', size: 1000 });
    const broken = (async function* () {
      yield new Uint8Array(50);
      throw new Error('connection reset');
    })();
    await expect(k.uploads.chunk('demo', job.id, 0, broken)).rejects.toThrow('connection reset');
    expect(k.uploads.status('demo', job.id)?.received).toBe(0);
    await k.uploads.chunk('demo', job.id, 0, once(new Uint8Array(50)));
    expect(k.uploads.status('demo', job.id)?.received).toBe(50);
  });

  it('refuses a second chunk, finish and abort while a chunk is in flight', async () => {
    k = kit();
    const job = k.uploads.start('demo', { kind: 'pmtiles', name: 'x', size: 100 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let started: () => void = () => undefined;
    const running = new Promise<void>((r) => (started = r));
    const slow = (async function* () {
      yield new Uint8Array(40);
      started();
      await gate;
      yield new Uint8Array(10);
    })();
    const first = k.uploads.chunk('demo', job.id, 0, slow);
    await running;
    await expect(k.uploads.chunk('demo', job.id, 0, once(new Uint8Array(50)))).rejects.toMatchObject({
      reason: 'bad_chunk',
    });
    expect(() => k.uploads.finish('demo', job.id)).toThrow(/in flight/);
    expect(() => k.uploads.abort('demo', job.id)).toThrow(/in flight/);
    release();
    expect((await first).received).toBe(50);
    expect(read(join(k.dir, 'tiles', 'demo', '.uploads', job.id, 'data')).length).toBe(50);
    expect(k.uploads.status('demo', job.id)?.received).toBe(50);
    await k.uploads.chunk('demo', job.id, 50, once(new Uint8Array(50)));
    expect(k.uploads.status('demo', job.id)?.received).toBe(100);
  });

  it('abort and failure remove the temp files', async () => {
    k = kit();
    const dirOf = (id: string): string => join(k.dir, 'tiles', 'demo', '.uploads', id);
    const open = k.uploads.start('demo', { kind: 'pmtiles', name: 'x', size: 100 });
    await k.uploads.chunk('demo', open.id, 0, once(new Uint8Array(40)));
    expect(existsSync(join(dirOf(open.id), 'data'))).toBe(true);
    expect(k.uploads.abort('demo', open.id)).toBe(true);
    expect(existsSync(dirOf(open.id))).toBe(false);
    const failed = await upload(k, 'pmtiles', new Uint8Array(300).fill(1));
    expect(failed?.state).toBe('failed');
    expect(readdirSync(dirOf(failed?.id ?? ''))).toEqual(['job.json']);
    expect(readdirSync(join(k.dir, 'tiles', 'demo')).filter((f) => f.endsWith('.pmtiles'))).toEqual([]);
  });

  it('does not abort a finished upload (the archive stays)', async () => {
    k = kit();
    const job = await upload(k, 'pmtiles', await fixtureArchive(1));
    expect(k.uploads.abort('demo', job?.id ?? '')).toBe(false);
    expect(k.uploads.archivePath('demo', job?.id ?? '')).toBeDefined();
  });
});

describe('limits', () => {
  it('refuses an upload over TILE_UPLOAD_MAX, extra bytes in a chunk and too many open uploads', async () => {
    k = kit();
    const over = { kind: 'zip', name: 'x', size: tileUploadMax('bytes') + 1 };
    expect(() => k.uploads.start('demo', over)).toThrow(/at most/);
    const job = k.uploads.start('demo', { kind: 'mbtiles', name: 'x', size: 10 });
    await expect(k.uploads.chunk('demo', job.id, 0, once(new Uint8Array(11)))).rejects.toMatchObject({
      reason: 'too_large',
    });
    k.uploads.start('demo', { kind: 'mbtiles', name: 'y', size: 10 });
    k.uploads.start('demo', { kind: 'mbtiles', name: 'z', size: 10 });
    expect(() => k.uploads.start('demo', { kind: 'mbtiles', name: 'w', size: 10 })).toThrow(/open upload/);
  });

  it('refuses an unknown kind and a vector format chosen by hand; a path-like id is no upload', () => {
    k = kit();
    expect(() => k.uploads.start('demo', { kind: 'exe', name: 'x', size: 10 })).toThrow(/ZIP, MBTiles/);
    expect(() => k.uploads.start('demo', { kind: 'zip', name: 'x', size: 10, format: 'pbf' })).toThrow(/PNG/);
    expect(k.uploads.status('demo', '../../etc')).toBeUndefined();
  });
});

describe('status', () => {
  it('reports progress while processing and the result at the end', async () => {
    k = kit();
    mbtiles(join(k.dir, 'p.mbtiles'), pyramid(4));
    const bytes = read(join(k.dir, 'p.mbtiles'));
    const job = k.uploads.start('demo', { kind: 'mbtiles', name: 'x', size: bytes.length });
    await k.uploads.chunk('demo', job.id, 0, once(bytes));
    expect(k.uploads.finish('demo', job.id).state).toBe('queued');
    while (k.uploads.status('demo', job.id)?.state !== 'done') await new Promise((r) => setImmediate(r));
    // The saved jobs, not a polling loop: with 341 tiles and a batch of 256 the one partial state lives for a
    // single tick, and a loaded machine skipped it (red land trains on 2026-10-03).
    const seen = k.saved.map((s) => `${s.state}:${s.progress.done}/${s.progress.total}`);
    expect(
      seen.some((s) => /^processing:[1-9]\d*\/341$/.test(s)),
      seen.join(' '),
    ).toBe(true);
    expect(k.uploads.status('demo', job.id)).toMatchObject({
      state: 'done',
      progress: { done: 341, total: 341 },
    });
  });
});
