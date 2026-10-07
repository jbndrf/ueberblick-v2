// WP-662: the pack tile protocol serves a pack tile, falls back to the network outside the pack, and overzooms above
// the layer's max_zoom. A small fixture .pmtiles stands in for a pack file.
import { describe, expect, it, vi } from 'vitest';
import { ancestorQuadrant, createPackProtocol, parseTileUrl } from './packs';
import type { PackFiles } from './packs';
import { buildPmtiles, fixtureFile } from './packs-fixture.testing';

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);
const ab = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const body = async (p: Promise<{ data: ArrayBuffer }>): Promise<number[]> => [
  ...new Uint8Array((await p).data),
];

// Tiles at z14 only: the layer's own max_zoom is 14 (below the pack's 17).
const file = fixtureFile(
  'h1/osm',
  'osm',
  buildPmtiles([
    { z: 14, x: 8800, y: 5400, data: bytes(1, 1, 1) },
    { z: 14, x: 8801, y: 5400, data: bytes(2, 2) },
    { z: 13, x: 4400, y: 2700, data: bytes(9) },
  ]),
  14,
);
const packs: PackFiles = { layerFiles: async (layer) => (layer === 'osm' ? [file] : []) };
const url = (z: number, x: number, y: number): string => `ubtile://osm/${z}/${x}/${y}`;

function protocol(
  over: { fetchTile?: (u: string) => Promise<ArrayBuffer | undefined>; packs?: PackFiles } = {},
) {
  const fetchTile = vi.fn(over.fetchTile ?? (async () => undefined));
  const crop = vi.fn(async (t: ArrayBuffer, q: { fx: number; fy: number; size: number }) =>
    ab(Uint8Array.from([...new Uint8Array(t), Math.round(q.fx * 100), Math.round(q.fy * 100)])),
  );
  const p = createPackProtocol({ packs: over.packs ?? packs, fetchTile, crop });
  p.registerTemplate('osm', 'https://t.example/{z}/{x}/{y}.png');
  return { p, fetchTile, crop, get: (u: string) => body(p.handler({ url: u }, new AbortController())) };
}

describe('pack protocol', () => {
  it('serves a tile from the pack without touching the network', async () => {
    const { get, fetchTile } = protocol();
    expect(await get(url(14, 8800, 5400))).toEqual([1, 1, 1]);
    expect(await get(url(14, 8801, 5400))).toEqual([2, 2]);
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it('falls back to the network outside the pack, with the layer template filled', async () => {
    const { get, fetchTile } = protocol({ fetchTile: async () => ab(bytes(7)) });
    expect(await get(url(14, 1, 1))).toEqual([7]);
    expect(fetchTile).toHaveBeenCalledWith('https://t.example/14/1/1.png', expect.anything());
  });

  it('overzooms above the layer max_zoom when the network has nothing', async () => {
    const { get, crop } = protocol();
    // z16 tile (35201, 21600) sits in the z14 tile (8800, 5400): 2 levels up, quadrant (1/4, 0)
    expect(await get(url(16, 35201, 21600))).toEqual([1, 1, 1, 25, 0]);
    expect(crop).toHaveBeenCalledTimes(1);
  });

  it('does not overzoom at or below max_zoom; a tile nothing has is an empty raster tile, not a throw', async () => {
    const { get, crop } = protocol();
    const png = await get(url(14, 2, 2));
    expect(png.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(crop).not.toHaveBeenCalled();
  });

  it('prefers the network above max_zoom over the overzoom', async () => {
    const { get, crop } = protocol({ fetchTile: async () => ab(bytes(5)) });
    expect(await get(url(16, 35201, 21600))).toEqual([5]);
    expect(crop).not.toHaveBeenCalled();
  });

  it('works with no packs on the device (no OPFS): the network answers', async () => {
    const { get } = protocol({ packs: { layerFiles: async () => [] }, fetchTile: async () => ab(bytes(3)) });
    expect(await get(url(14, 8800, 5400))).toEqual([3]);
  });

  it('does not crop vector tiles; a missing one is an empty vector tile', async () => {
    const vec = { ...file, tileType: 'vector' as const };
    const { get, crop } = protocol({ packs: { layerFiles: async () => [vec] } });
    expect(await get(url(16, 35201, 21600))).toEqual([]);
    expect(crop).not.toHaveBeenCalled();
  });

  it('parses its URLs and computes the ancestor quadrant', () => {
    expect(parseTileUrl('ubtile://osm/3/4/5')).toEqual({ layer: 'osm', z: 3, x: 4, y: 5 });
    expect(parseTileUrl('https://x/1/2/3')).toBeUndefined();
    expect(ancestorQuadrant({ z: 16, x: 35201, y: 21600 }, 2)).toEqual({
      parent: { z: 14, x: 8800, y: 5400 },
      fx: 0.25,
      fy: 0,
      size: 0.25,
    });
  });
});
