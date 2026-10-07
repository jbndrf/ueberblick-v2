/** WP-591: readPage takes its viewport from core `viewportFrom`; pages equal the old plain join, in the same order. */
import type { Bbox } from '@ueberblick/core';
import { viewportPageFrom } from '@ueberblick/core/expr/compile';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/driver';
import { Model, ingest, ob, openDb, point } from '../../store/facts/sqlite.testkit';
import { readPage } from './items';

const ALL = { sql: '1=1', params: [] };

/** The statement of before WP-591, as the reference. */
function oldPage(db: Db, box: Bbox, after: number, take: number, type: string): number[] {
  return db
    .prepare<{ rid: number }>(
      `SELECT f.rowid AS rid FROM features f JOIN feature_bbox r ON r.rid = f.rowid
       WHERE f.type = ? AND f.lifecycle IN ('active','completed') AND f.rowid > ? AND r.minx <= ? AND r.maxx >= ? AND r.miny <= ? AND r.maxy >= ?
       ORDER BY f.rowid LIMIT ?`,
    )
    .all(type, after, box[2], box[0], box[3], box[1], take)
    .map((r) => r.rid);
}

function pages(db: Db, bbox: Bbox, limit: number, type: string): number[][] {
  const out: number[][] = [];
  let after = 0;
  for (;;) {
    const r = readPage(db, { type, visible: ALL, limit, after, bbox });
    if (!r.ok) throw new Error(r.message);
    out.push(r.page.rows.map((x) => x.rid));
    if (r.page.next === undefined) return out;
    after = r.page.next;
  }
}

describe('OGC items viewport (WP-591)', () => {
  it('pages of a bbox request equal the old statement, in rowid order, across cursors', () => {
    const coord = fc.integer({ min: -30, max: 30 });
    const boxArb = fc
      .tuple(coord, coord, fc.integer({ min: 0, max: 70 }), fc.integer({ min: 0, max: 70 }))
      .map(([x, y, w, h]): Bbox => [x, y, x + w, y + h]);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(coord, coord, fc.boolean()), { maxLength: 40 }),
        boxArb,
        fc.integer({ min: 1, max: 7 }),
        (pts, box, limit) => {
          const db = openDb();
          const obs = pts.flatMap(([x, y, other], i) => [
            ob(`f${i}`, '$type', other ? 'plot' : 'tree', 2 * i + 1),
            ob(`f${i}`, 'geometry', point(x, y), 2 * i + 2),
          ]);
          ingest(db, new Model(), obs, 7);
          const want: number[][] = [];
          let after = 0;
          for (;;) {
            const batch = oldPage(db, box, after, limit + 1, 'tree');
            const rows = batch.slice(0, limit);
            want.push(rows);
            if (batch.length <= limit) break;
            after = rows[rows.length - 1] as number;
          }
          expect(pages(db, box, limit, 'tree')).toEqual(want);
          for (const p of want) expect(p).toEqual([...p].sort((a, b) => a - b));
          db.close();
        },
      ),
      { numRuns: 40 },
    );
  });

  it('the statement takes its from-clause from core viewportPageFrom', () => {
    const db = openDb();
    const obs = Array.from({ length: 100 }, (_, i) => [
      ob(`f${i}`, '$type', 'tree', 2 * i + 1),
      ob(`f${i}`, 'geometry', point(i % 10, Math.floor(i / 10)), 2 * i + 2),
    ]).flat();
    ingest(db, new Model(), obs, 50);
    const seen: string[] = [];
    const spy = { ...db, prepare: ((sql: string) => (seen.push(sql), db.prepare(sql))) as Db['prepare'] };
    readPage(spy as Db, { type: 'tree', visible: ALL, limit: 5, after: 0, bbox: [0, 0, 2, 2] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(viewportPageFrom({ feature: 'f', box: 'r' }).from);
    db.close();
  });
});
