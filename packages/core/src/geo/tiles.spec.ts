import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { estimatePack, layerMaxZoom, tileCount, tileRanges, tilesAtZoom, type Bounds } from './tiles';

/** Independent brute force: walk every tile of the zoom and test its lon/lat box against the bounds. */
const tileLon = (x: number, z: number): number => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number): number => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
function brute(b: Bounds, z: number): number {
  const [w, s, e, n] = b;
  let count = 0;
  for (let x = 0; x < 2 ** z; x++) {
    const x0 = tileLon(x, z);
    const x1 = tileLon(x + 1, z);
    if (!(x0 < e && x1 > w)) continue;
    for (let y = 0; y < 2 ** z; y++) {
      const top = tileLat(y, z);
      const bottom = tileLat(y + 1, z);
      if (top > s && bottom < n) count++;
    }
  }
  return count;
}

const boundsArb = fc
  .tuple(
    fc.double({ min: -179.9, max: 179.9, noNaN: true }),
    fc.double({ min: -84.9, max: 84.9, noNaN: true }),
    fc.double({ min: 0.001, max: 90, noNaN: true }),
    fc.double({ min: 0.001, max: 60, noNaN: true }),
  )
  // Off the 1e-4 grid by a fixed offset, so no edge sits within float noise of a tile edge (the two
  // formulas may then differ in the last ulp, which is not what the property is about).
  .map(([w, s, dw, dn]): Bounds => {
    const g = (v: number): number => Math.round(v * 1e4) / 1e4 + 0.00003;
    return [g(w), g(s), Math.min(g(w) + g(dw), 180), Math.min(g(s) + g(dn), 85)];
  });

describe('tile estimate', () => {
  it('knows the world at zoom 0 and 1', () => {
    expect(tilesAtZoom([-180, -85, 180, 85], 0)).toBe(1);
    expect(tilesAtZoom([-180, -85, 180, 85], 1)).toBe(4);
    expect(tileCount([-180, -85, 180, 85], 0, 2)).toBe(1 + 4 + 16);
  });

  it('equals the brute-force count of intersecting tiles (property)', () => {
    fc.assert(
      fc.property(boundsArb, fc.integer({ min: 0, max: 7 }), (b, z) => {
        expect(tilesAtZoom(b, z)).toBe(brute(b, z));
      }),
      { numRuns: 150 },
    );
  });

  it('grows monotonically with max_zoom (property)', () => {
    fc.assert(
      fc.property(boundsArb, fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 8 }), (b, lo, d) => {
        expect(tileCount(b, lo, lo + d + 1)).toBeGreaterThanOrEqual(tileCount(b, lo, lo + d));
      }),
    );
  });

  it('counts nothing for an empty zoom range', () => {
    expect(tileCount([7, 50, 8, 51], 5, 3)).toBe(0);
  });

  it('caps the per-layer max zoom at the source maximum', () => {
    expect(layerMaxZoom(17, 14)).toBe(14);
    expect(layerMaxZoom(12, 14)).toBe(12);
    expect(layerMaxZoom(17, undefined)).toBe(17);
  });

  it('estimates a pack per layer, with the layer cap and bytes per tile type', () => {
    const b: Bounds = [7.08, 50.7, 7.14, 50.75];
    const e = estimatePack(b, 10, 16, [
      { key: 'a', tileType: 'raster', sourceMaxZoom: 12 },
      { key: 'b', tileType: 'vector', sourceMaxZoom: undefined },
    ]);
    expect(e.layers[0]).toMatchObject({ key: 'a', maxZoom: 12, tiles: tileCount(b, 10, 12) });
    expect(e.layers[1]).toMatchObject({ key: 'b', maxZoom: 16, tiles: tileCount(b, 10, 16) });
    const [a, v] = [e.layers[0]?.tiles ?? 0, e.layers[1]?.tiles ?? 0];
    expect(e.tiles).toBe(a + v);
    expect(e.bytes).toBe(a * 15_000 + v * 6_000);
  });
});

describe('tileRanges', () => {
  it('agrees with tileCount and tilesAtZoom (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -179, max: 178, noNaN: true }),
        fc.double({ min: -84, max: 83, noNaN: true }),
        fc.double({ min: 0.001, max: 3, noNaN: true }),
        fc.integer({ min: 0, max: 8 }),
        (w, s, size, z) => {
          const b: Bounds = [w, s, Math.min(179.9, w + size), Math.min(84.9, s + size)];
          const { x, y } = tileRanges(b, z);
          expect(x[0]).toBeLessThanOrEqual(x[1]);
          expect(y[0]).toBeLessThanOrEqual(y[1]);
          expect((x[1] - x[0] + 1) * (y[1] - y[0] + 1)).toBe(tilesAtZoom(b, z));
          expect(tileCount(b, z, z)).toBe(tilesAtZoom(b, z));
        },
      ),
    );
  });
});
