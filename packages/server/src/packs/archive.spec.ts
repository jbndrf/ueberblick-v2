import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compression, TileType, zxyToTileId } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { deserializeDirectory, openArchive } from './archive-read';
import { buildDirectories, serializeDirectory, writeArchive, type WrittenTile } from './archive-write';
import { httpFetchRange, RangeNotFound, withRetries } from './fetch';
import { fixtureArchive, must, reader, serve, SOURCE_URL, tilePayload } from './testkit';

describe('directories', () => {
  it('round-trip through the spec serialization', () => {
    const entries = [
      { tileId: 0, offset: 0, length: 5, runLength: 1 },
      { tileId: 1, offset: 5, length: 7, runLength: 1 },
      { tileId: 9, offset: 100, length: 3, runLength: 1 },
    ];
    expect(deserializeDirectory(serializeDirectory(entries))).toEqual(entries);
  });

  it('splits into leaf directories when one root would not fit the first 16 KiB, and a reader finds every tile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leaf-'));
    try {
      const tiles: WrittenTile[] = [];
      const chunks: Buffer[] = [];
      let offset = 0;
      const n = 40_000;
      let id = 0;
      let seed = 12345;
      const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648);
      for (let i = 0; i < n; i++) {
        // random gaps and lengths so the directory does not compress to nothing
        const data = Buffer.alloc(1 + (rnd() % 5000), 1);
        id += 1 + (rnd() % 1000);
        tiles.push({ tileId: id, offset, length: data.length });
        chunks.push(data);
        offset += data.length;
      }
      expect(buildDirectories(tiles).leaves.length).toBeGreaterThan(0);
      writeFileSync(join(dir, 'spool'), Buffer.concat(chunks));
      await writeArchive(join(dir, 'out'), join(dir, 'spool'), offset, tiles, {
        bounds: [0, 0, 1, 1],
        tileType: TileType.Mvt,
        tileCompression: Compression.Gzip,
        metadata: Buffer.from('{}'),
      });
      const bytes = new Uint8Array(readFileSync(join(dir, 'out')));
      const source = await openArchive(serve(bytes).fetchRange, SOURCE_URL);
      expect(source.header.rootDirectoryLength).toBeLessThanOrEqual(16384 - 127);
      for (const i of [0, 1, 4_999, 20_000, n - 1]) {
        const loc = await source.locate(must(tiles[i]).tileId);
        expect(loc).toEqual({
          offset: source.header.tileDataOffset + must(tiles[i]).offset,
          length: must(tiles[i]).length,
        });
      }
      expect(await source.locate(must(tiles[7]).tileId + 1)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('source archive', () => {
  it('locates tiles of the fixture the way the pmtiles reader does', async () => {
    const bytes = await fixtureArchive(4);
    const source = await openArchive(serve(bytes).fetchRange, SOURCE_URL);
    expect(source.header).toMatchObject({ maxZoom: 4, tileType: TileType.Png });
    const loc = await source.locate(zxyToTileId(3, 5, 2));
    expect(bytes.slice(must(loc).offset, must(loc).offset + must(loc).length)).toEqual(tilePayload(3, 5, 2));
    expect(await source.locate(zxyToTileId(5, 0, 0))).toBeUndefined();
    expect((await reader(bytes).getHeader()).numAddressedTiles).toBe(1 + 4 + 16 + 64 + 256);
  });

  it('refuses a file that is not a PMTiles archive', async () => {
    await expect(openArchive(serve(new Uint8Array(20000)).fetchRange, SOURCE_URL)).rejects.toThrow(
      'not a PMTiles archive',
    );
  });
});

describe('http fetchRange', () => {
  it('sends a Range and the identifying User-Agent, never exceeds the concurrency limit, and rejects a failed status', async () => {
    const seen: Headers[] = [];
    let active = 0;
    let peak = 0;
    const fake = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: seen.length === 7 ? 503 : 206 });
    }) as unknown as typeof fetch;
    const get = httpFetchRange({
      fetch: fake,
      originFetch: fake,
      userAgent: 'Ueberblick-pack-builder/4',
      concurrency: 2,
      baseUrl: 'https://own.test',
    });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => get('/tiles/a.pmtiles', i * 10, 4)),
    );
    expect(peak).toBe(2);
    expect(seen[0]?.get('range')).toBe('bytes=0-3');
    expect(seen.every((h) => h.get('user-agent') === 'Ueberblick-pack-builder/4')).toBe(true);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('reads a same-origin path against the origin without the guarded fetch; `//host` is absolute and guarded', async () => {
    const guarded: string[] = [];
    const direct: string[] = [];
    const answer = (into: string[]) =>
      (async (url: string) => {
        into.push(url);
        return new Response(new Uint8Array([1, 2]), { status: 206 });
      }) as unknown as typeof fetch;
    const get = httpFetchRange({
      fetch: answer(guarded),
      originFetch: answer(direct),
      userAgent: 'x',
      baseUrl: 'https://own.test',
    });
    await get('/tiles/a.pmtiles', 0, 2);
    await get('//evil.example/x.pmtiles', 0, 2);
    await get('https://tiles.example/a.pmtiles', 0, 2);
    expect(direct).toEqual(['https://own.test/tiles/a.pmtiles']);
    expect(guarded).toEqual(['//evil.example/x.pmtiles', 'https://tiles.example/a.pmtiles']);
  });

  it('never sends a path that the URL parser would move to another host to the unguarded fetch', async () => {
    const guarded: string[] = [];
    const direct: string[] = [];
    const answer = (into: string[]) =>
      (async (url: string) => {
        into.push(url);
        return new Response(new Uint8Array([1]), { status: 206 });
      }) as unknown as typeof fetch;
    const get = httpFetchRange({
      fetch: answer(guarded),
      originFetch: answer(direct),
      userAgent: 'x',
      baseUrl: 'https://own.test',
    });
    for (const bad of ['/\\evil.com/x', '/\t/evil.com/x', '/\n/evil.com/x']) await get(bad, 0, 1);
    expect(direct).toEqual([]);
    expect(guarded).toHaveLength(3);
  });

  it('answers 404 with a typed RangeNotFound that is not retried', async () => {
    let calls = 0;
    const gone = (async () => {
      calls++;
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const get = withRetries(
      httpFetchRange({ fetch: gone, originFetch: gone, userAgent: 'x', baseUrl: 'https://own.test' }),
      {
        sleep: async () => undefined,
      },
    );
    await expect(get('/t/1.png', 0, 1)).rejects.toBeInstanceOf(RangeNotFound);
    expect(calls).toBe(1);
  });
});
