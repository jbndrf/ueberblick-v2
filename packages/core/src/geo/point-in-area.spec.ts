// WP-041.2: the Point vs (Multi)Polygon fast path agrees with JSTS (plain relate path) on every predicate it answers.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo } from './index';
import { createJstsEngine } from './engine-jsts';
import { pointInArea } from './point-in-area';
import type { Geometry, MultiPolygon, Point, Polygon, Position } from './contract';

const geo = createGeo();
const plain = createGeo(createJstsEngine({ prepared: false }));
const FAST = ['intersects', 'within', 'contains'] as const;

const ring = (x0: number, y0: number, x1: number, y1: number, cw = false): Position[] => {
  const r: Position[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  return cw ? r.reverse() : r;
};
const pt = (x: number, y: number): Point => ({ type: 'Point', coordinates: [x, y] });

const grid = fc.integer({ min: 0, max: 20 });
const box = fc
  .tuple(grid, grid, fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }))
  .map(([x, y, w, h]) => ({ x, y, w, h }));

/** A square with an optional hole strictly inside, on an integer grid so boundary hits are common. */
const polygon: fc.Arbitrary<Polygon> = fc.tuple(box, fc.boolean()).map(([b, holed]) =>
  holed && b.w >= 3 && b.h >= 3
    ? {
        type: 'Polygon',
        coordinates: [
          ring(b.x, b.y, b.x + b.w, b.y + b.h),
          ring(b.x + 1, b.y + 1, b.x + b.w - 1, b.y + b.h - 1, true),
        ],
      }
    : { type: 'Polygon', coordinates: [ring(b.x, b.y, b.x + b.w, b.y + b.h)] },
);
/** Valid multipolygons only: members sit in disjoint x bands (JSTS rejects overlapping members itself). */
const multi: fc.Arbitrary<MultiPolygon> = fc.array(box, { minLength: 1, maxLength: 3 }).map((bs) => ({
  type: 'MultiPolygon',
  coordinates: bs.map((b, i) => [ring(i * 10, b.y, i * 10 + b.w, b.y + b.h)]),
}));
const point: fc.Arbitrary<Point> = fc.oneof(
  fc.tuple(fc.integer({ min: -2, max: 30 }), fc.integer({ min: -2, max: 30 })).map(([x, y]) => pt(x, y)),
  fc
    .tuple(fc.double({ min: -2, max: 30, noNaN: true }), fc.double({ min: -2, max: 30, noNaN: true }))
    .map(([x, y]) => pt(x, y)),
  // on an edge / near a vertex
  fc.tuple(grid, grid, fc.double({ min: 0, max: 8, noNaN: true })).map(([x, y, t]) => pt(x + t, y)),
);

describe('pointInArea agrees with JSTS', () => {
  it.each(FAST)('%s: Point vs Polygon and MultiPolygon, both argument orders', (predicate) => {
    fc.assert(
      fc.property(fc.oneof(polygon, multi), point, (area, p) => {
        const a: Geometry = area;
        const expected = plain.test(
          predicate,
          predicate === 'contains' ? a : p,
          predicate === 'contains' ? p : a,
        );
        expect(geo.test(predicate, predicate === 'contains' ? a : p, predicate === 'contains' ? p : a)).toBe(
          expected,
        );
        if (predicate === 'intersects') expect(geo.test(predicate, a, p)).toBe(plain.test(predicate, a, p));
      }),
      { numRuns: 3000 },
    );
  });

  it('answers inside, outside and in-hole points itself, and defers boundary points', () => {
    const holed: Polygon = { type: 'Polygon', coordinates: [ring(0, 0, 10, 10), ring(3, 3, 7, 7, true)] };
    expect(pointInArea(pt(1, 1), holed)).toBe('interior');
    expect(pointInArea(pt(20, 1), holed)).toBe('exterior');
    expect(pointInArea(pt(5, 5), holed)).toBe('exterior');
    expect(pointInArea(pt(0, 5), holed)).toBeUndefined();
    expect(pointInArea(pt(10, 10), holed)).toBeUndefined();
    expect(pointInArea(pt(3, 5), holed)).toBeUndefined();
  });

  it('boundary points: intersects yes, within and contains no', () => {
    const sq: Polygon = { type: 'Polygon', coordinates: [ring(0, 0, 4, 4)] };
    for (const p of [pt(0, 2), pt(4, 4), pt(2, 0)]) {
      expect(geo.test('intersects', p, sq)).toBe(true);
      expect(geo.test('within', p, sq)).toBe(false);
      expect(geo.test('contains', sq, p)).toBe(false);
    }
  });
});
