import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGeo } from './index';
import { createJstsEngine, jstsEngine } from './engine-jsts';
import { GEO_PREDICATES } from '../registry';
import {
  LINE,
  MULTI,
  PT_INSIDE,
  PT_ON_EDGE,
  PT_ON_VERTEX,
  PT_OUTSIDE,
  SQUARE,
  SQUARE_Z,
  WITH_HOLE,
} from './fixtures';
import type { Geometry, Polygon } from './contract';

const geo = createGeo();
/** Reference: the plain relate path, no prepared-polygon shortcuts. */
const plain = createGeo(createJstsEngine({ prepared: false }));

const adjacent: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [13.41, 52.5],
      [13.42, 52.5],
      [13.42, 52.51],
      [13.41, 52.51],
      [13.41, 52.5],
    ],
  ],
};
const overlapping: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [13.405, 52.505],
      [13.415, 52.505],
      [13.415, 52.515],
      [13.405, 52.515],
      [13.405, 52.505],
    ],
  ],
};
const crossing: Geometry = {
  type: 'LineString',
  coordinates: [
    [13.405, 52.49],
    [13.405, 52.52],
  ],
};

describe('Simple Features predicates (DE-9IM boundary semantics)', () => {
  it('a point on the boundary intersects, is covered, but is not within', () => {
    for (const p of [PT_ON_EDGE, PT_ON_VERTEX]) {
      expect(geo.test('intersects', p, SQUARE)).toBe(true);
      expect(geo.test('within', p, SQUARE)).toBe(false);
      expect(geo.test('coveredBy', p, SQUARE)).toBe(true);
      expect(geo.test('covers', SQUARE, p)).toBe(true);
      expect(geo.test('touches', p, SQUARE)).toBe(true);
      expect(geo.test('contains', SQUARE, p)).toBe(false);
    }
  });

  it('interior and exterior points', () => {
    expect(geo.test('within', PT_INSIDE, SQUARE)).toBe(true);
    expect(geo.test('contains', SQUARE, PT_INSIDE)).toBe(true);
    expect(geo.test('disjoint', PT_OUTSIDE, SQUARE)).toBe(true);
    expect(geo.test('intersects', PT_OUTSIDE, SQUARE)).toBe(false);
  });

  it('holes are outside', () => {
    const inHole: Geometry = { type: 'Point', coordinates: [13.405, 52.505] };
    expect(geo.test('within', inHole, WITH_HOLE)).toBe(false);
    expect(geo.test('within', PT_INSIDE, MULTI)).toBe(true);
  });

  it('polygon relations', () => {
    expect(geo.test('touches', SQUARE, adjacent)).toBe(true);
    expect(geo.test('overlaps', SQUARE, overlapping)).toBe(true);
    expect(geo.test('equals', SQUARE, SQUARE)).toBe(true);
    expect(geo.test('crosses', crossing, SQUARE)).toBe(true);
    expect(geo.test('crosses', LINE, SQUARE)).toBe(false);
  });

  it('every registered predicate is implemented', () => {
    for (const key of GEO_PREDICATES.keys) expect(typeof geo.test(key, SQUARE, SQUARE)).toBe('boolean');
  });

  it('ignores Z', () => {
    expect(geo.test('equals', SQUARE, SQUARE_Z)).toBe(true);
  });

  it('within and contains are converses; intersects and disjoint are complements (property)', () => {
    const pt = fc
      .tuple(
        fc.double({ min: 13.39, max: 13.42, noNaN: true }),
        fc.double({ min: 52.49, max: 52.52, noNaN: true }),
      )
      .map(([x, y]): Geometry => ({ type: 'Point', coordinates: [x, y] }));
    fc.assert(
      fc.property(pt, (p) => {
        expect(geo.test('within', p, SQUARE)).toBe(geo.test('contains', SQUARE, p));
        expect(geo.test('intersects', p, SQUARE)).toBe(!geo.test('disjoint', p, SQUARE));
        expect(geo.test('covers', SQUARE, p)).toBe(geo.test('coveredBy', p, SQUARE));
      }),
      { numRuns: 300 },
    );
  });

  it('the engine is swappable', () => {
    const fake = createGeo({ ...jstsEngine, name: 'fake', test: () => true });
    expect(fake.test('disjoint', SQUARE, SQUARE)).toBe(true);
    expect(jstsEngine.name).toBe('jsts');
  });
});

describe('spatial index', () => {
  const polys: [string, Geometry][] = [
    ['a', SQUARE],
    ['b', adjacent],
    ['c', overlapping],
    ['d', MULTI],
  ];
  const idx = geo.index(polys);

  it('reports its size', () => {
    expect(idx.size).toBe(4);
  });

  it('point in area returns exactly the areas that contain the point', () => {
    expect([...idx.query('within', PT_INSIDE)].sort()).toEqual(['a', 'd']);
    expect(idx.query('within', PT_OUTSIDE)).toEqual([]);
  });

  it('boundary points are intersected but not within', () => {
    expect([...idx.query('intersects', { type: 'Point', coordinates: [13.41, 52.507] })].sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(idx.query('within', { type: 'Point', coordinates: [13.41, 52.507] })).toEqual(['c']);
  });

  it('disjoint returns everything the bbox prefilter would have dropped', () => {
    expect([...idx.query('disjoint', PT_OUTSIDE)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(idx.query('disjoint', PT_INSIDE)).toEqual(['b']);
  });

  it('agrees with a brute-force scan (property)', () => {
    const pt = fc
      .tuple(
        fc.double({ min: 13.39, max: 13.53, noNaN: true }),
        fc.double({ min: 52.49, max: 52.52, noNaN: true }),
      )
      .map(([x, y]): Geometry => ({ type: 'Point', coordinates: [x, y] }));
    for (const predicate of GEO_PREDICATES.keys) {
      fc.assert(
        fc.property(pt, (p) => {
          const brute = polys.filter(([, g]) => plain.test(predicate, p, g)).map(([k]) => k);
          expect([...idx.query(predicate, p)].sort()).toEqual(brute.sort());
        }),
        { numRuns: 40 },
      );
    }
  });
});
