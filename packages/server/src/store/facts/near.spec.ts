/** Facts.near over the R*Tree agrees with a brute-force bbox filter. */
import type { Bbox } from '@ueberblick/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFacts } from './index';
import { INVERSE, Model, ingest, k, ob, openDb, point, square } from './sqlite.testkit';

const meets = (a: Bbox, b: Bbox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

describe('Facts.near (server)', () => {
  it('filters by type, ignores features without geometry and deleted ones', () => {
    const db = openDb();
    ingest(
      db,
      new Model(),
      [
        ob('t0', '$type', 'tree', 1),
        ob('t0', 'geometry', point(1, 1), 2),
        ob('t1', '$type', 'tree', 3),
        ob('t2', '$type', 'tree', 4),
        ob('t2', 'geometry', point(1, 1), 5),
        ob('t2', '$lifecycle', 'deleted', 6),
        ob('a0', '$type', 'area', 7),
        ob('a0', 'geometry', square(0, 0, 3), 8),
      ],
      10,
    );
    const facts = createFacts(db, INVERSE);
    expect([...facts.near(k('tree'), [0, 0, 2, 2])].map((f) => f.id)).toEqual(['t0']);
    expect([...facts.near(k('area'), [0, 0, 2, 2])].map((f) => f.id)).toEqual(['a0']);
    expect([...facts.near(k('area'), [5, 5, 6, 6])]).toEqual([]);
  });

  it('counts edge contact as intersecting', () => {
    const db = openDb();
    ingest(db, new Model(), [ob('t0', '$type', 'tree', 1), ob('t0', 'geometry', point(1, 1), 2)], 10);
    const facts = createFacts(db, INVERSE);
    expect([...facts.near(k('tree'), [1, 1, 3, 3])]).toHaveLength(1);
    expect([...facts.near(k('tree'), [-2, -2, 1, 1])]).toHaveLength(1);
    expect([...facts.near(k('tree'), [1.1, 1, 3, 3])]).toHaveLength(0);
  });

  it('agrees with a brute-force filter on random points and boxes', () => {
    const coord = fc.integer({ min: -50, max: 50 });
    const boxArb = fc
      .tuple(
        fc.integer({ min: -60, max: 60 }),
        fc.integer({ min: -60, max: 60 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
      )
      .map(([x, y, w, h]): Bbox => [x, y, x + w, y + h]);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(coord, coord), { maxLength: 25 }),
        fc.array(boxArb, { minLength: 1, maxLength: 6 }),
        (pts, boxes) => {
          const db = openDb();
          const obs = pts.flatMap(([x, y], i) => [
            ob(`t${i}`, '$type', 'tree', 2 * i + 1),
            ob(`t${i}`, 'geometry', point(x, y), 2 * i + 2),
          ]);
          ingest(db, new Model(), obs, 10);
          const facts = createFacts(db, INVERSE);
          for (const b of boxes) {
            const want = pts.flatMap(([x, y], i) => (meets([x, y, x, y], b) ? [`t${i}`] : [])).sort();
            const got = [...facts.near(k('tree'), b)].map((f) => f.id as string).sort();
            expect(got).toEqual(want);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
