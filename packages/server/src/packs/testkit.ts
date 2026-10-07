/** Test support for the pack job: a fixture PMTiles archive in memory, a local `fetchRange`, and a project file with packs. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PMTiles, TileType, Compression, zxyToTileId, type Source } from 'pmtiles';
import { golden } from '../store/run/testkit';
import type { TemplateFile } from '@ueberblick/core';
import { writeArchive, type WrittenTile } from './archive-write';
import type { FetchRange } from './fetch';

export const SOURCE_URL = 'https://tiles.test/region.pmtiles';

/** The value, or a thrown error: for tests that read a row they know is there. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** The bytes the fixture stores for a tile: readable, unique per tile, so a test can tell a wrong tile from a right one. */
export const tilePayload = (z: number, x: number, y: number): Uint8Array =>
  new Uint8Array(Buffer.from(`tile ${z}/${x}/${y}`));

/** A complete pyramid from zoom 0 to `maxZoom` over the world, tile data in tile-id order. */
export async function fixtureArchive(
  maxZoom: number,
  tileType: TileType = TileType.Png,
): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'pack-fixture-'));
  try {
    const all: { tileId: number; z: number; x: number; y: number }[] = [];
    for (let z = 0; z <= maxZoom; z++)
      for (let x = 0; x < 2 ** z; x++)
        for (let y = 0; y < 2 ** z; y++) all.push({ tileId: zxyToTileId(z, x, y), z, x, y });
    all.sort((a, b) => a.tileId - b.tileId);
    const tiles: WrittenTile[] = [];
    const chunks: Uint8Array[] = [];
    let offset = 0;
    for (const t of all) {
      const data = tilePayload(t.z, t.x, t.y);
      tiles.push({ tileId: t.tileId, offset, length: data.length });
      chunks.push(data);
      offset += data.length;
    }
    writeFileSync(join(dir, 'spool'), Buffer.concat(chunks));
    await writeArchive(join(dir, 'out'), join(dir, 'spool'), offset, tiles, {
      bounds: [-180, -85, 180, 85],
      tileType,
      tileCompression: Compression.None,
      metadata: Buffer.from(JSON.stringify({ name: 'fixture' })),
    });
    return new Uint8Array(readFileSync(join(dir, 'out')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface Served {
  readonly fetchRange: FetchRange;
  /** Calls made so far: `[offset, length]`. */
  readonly calls: [number, number][];
}

/** `fetchRange` over bytes in memory; `failFrom` (calls from that number on, 1-based) throw. */
export function serve(bytes: Uint8Array, opts: { failFrom?: number } = {}): Served {
  const calls: [number, number][] = [];
  return {
    calls,
    fetchRange: async (_url, offset, length) => {
      calls.push([offset, length]);
      if (opts.failFrom !== undefined && calls.length >= opts.failFrom) throw new Error('connection reset');
      return bytes.slice(offset, offset + length);
    },
  };
}

/** A `pmtiles` reader over bytes, to read a built file back with the library's own reader. */
export function reader(bytes: Uint8Array): PMTiles {
  const source: Source = {
    getKey: () => 'built',
    getBytes: async (offset, length) => ({ data: bytes.slice(offset, offset + length).buffer }),
  };
  return new PMTiles(source);
}

/** The golden project file with one `pmtiles` layer ("basis") and the given packs. */
export function packFile(
  packs: Record<string, { bounds: [number, number, number, number]; min_zoom: number; max_zoom: number }>,
  tweak: (f: TemplateFile) => void = () => undefined,
): TemplateFile {
  const file = structuredClone(golden('musterstadt-plain').file);
  file.map = {
    layers: { basis: { label: { de: 'Basis' }, kind: 'base', source: { type: 'pmtiles', url: SOURCE_URL } } },
    packs: Object.fromEntries(
      Object.entries(packs).map(([key, p]) => [key, { label: { de: key }, ...p, layers: ['basis'] }]),
    ),
  };
  tweak(file);
  return file;
}
