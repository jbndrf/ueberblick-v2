import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGeo } from './index';
import type { Geometry, Point, Polygon } from './contract';

const geo = createGeo();
const pt = (lon: number, lat: number): Point => ({ type: 'Point', coordinates: [lon, lat] });

const box = (x: number, y: number, w: number, h: number, z = false): Polygon => {
  const p = (a: number, b: number): [number, number] | [number, number, number] => (z ? [a, b, 5] : [a, b]);
  return { type: 'Polygon', coordinates: [[p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h), p(x, y)]] };
};

function brute(entries: readonly (readonly [number, Geometry])[], probe: Geometry) {
  let best: { key: number; distanceM: number } | undefined;
  for (const [key, g] of entries) {
    const d = geo.distanceM(probe, g);
    if (!best || d < best.distanceM) best = { key, distanceM: d };
  }
  return best;
}

const num = (min: number, max: number) => fc.double({ min, max, noNaN: true });
const polyArb = fc
  .record({ x: num(13, 13.5), y: num(52, 52.5), w: num(0.001, 0.05), h: num(0.001, 0.05) })
  .map(({ x, y, w, h }) => box(x, y, w, h));

describe('index.nearest', () => {
  it('is undefined on an empty index', () => {
    expect(geo.index<number>([]).nearest(pt(13, 52))).toBeUndefined();
  });

  it('a point inside a polygon is at distance 0 from it', () => {
    const idx = geo.index([
      [1, box(13, 52, 0.1, 0.1)],
      [2, box(14, 52, 0.1, 0.1)],
    ] as const);
    expect(idx.nearest(pt(13.05, 52.05))).toEqual({ key: 1, distanceM: 0 });
  });

  it('accepts Z geometries (H1)', () => {
    const idx = geo.index([[1, box(13, 52, 0.1, 0.1, true)]] as const);
    expect(idx.nearest(pt(13.5, 52.05))?.key).toBe(1);
  });

  it('breaks ties by the earlier entry', () => {
    const idx = geo.index([
      [7, box(13, 52, 0.1, 0.1)],
      [3, box(13, 52, 0.1, 0.1)],
    ] as const);
    expect(idx.nearest(pt(13.05, 52.05))?.key).toBe(7);
  });

  it('equals the brute-force nearest on random polygon sets', () => {
    fc.assert(
      fc.property(
        fc.array(polyArb, { minLength: 1, maxLength: 80 }),
        num(12.9, 13.6),
        num(51.9, 52.6),
        fc.boolean(),
        (polys, lon, lat, duplicate) => {
          const list = duplicate ? [...polys, ...polys.slice(0, 3)] : polys;
          const entries = list.map((g, i) => [i, g] as const);
          const got = geo.index(entries).nearest(pt(lon, lat));
          const want = brute(entries, pt(lon, lat));
          expect(got?.key).toBe(want?.key);
          expect(Math.abs((got?.distanceM ?? NaN) - (want?.distanceM ?? NaN))).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 300 },
    );
  });
});
