/**
 * WP-591: the plain `feature_bbox JOIN features` against `viewportFrom` (CROSS JOIN, R*Tree first) for `bboxQuery`, and the CROSS JOIN against `viewportPageFrom` (plain JOIN) for an items page,
 * in one process on the same 60k store, alternating, for the two server reads: `bboxQuery` (ordered by id) and an
 * OGC items page (`f.rowid > ? ORDER BY f.rowid LIMIT`). Viewports of 1 %, 10 % and 100 % of the extent, with and
 * without a `cfg_idx_*` expression index on features (what a deployed project has).
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import type { Db } from '../../packages/server/src/db/driver';
import { bboxQuery } from '../../packages/server/src/store/facts';
import { readPage } from '../../packages/server/src/http/ogc/items';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const OLD_NEAR = 'r.minx <= ? AND r.maxx >= ? AND r.miny <= ? AND r.maxy >= ?';

type Box = readonly [number, number, number, number];

describe('bench: viewport shapes (WP-591)', () => {
  it('bboxQuery and OGC items page, old shape against viewportFrom', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const e = db
      .prepare<{ w: number; s: number; e: number; n: number }>(
        'SELECT min(minx) AS w, min(miny) AS s, max(maxx) AS e, max(maxy) AS n FROM feature_bbox',
      )
      .get() as { w: number; s: number; e: number; n: number };
    const boxes = (share: number, n: number): Box[] =>
      Array.from({ length: n }, (_, i) => {
        const side = Math.sqrt(share);
        const fx = (((i * 37) % 100) / 100) * (1 - side);
        const fy = (((i * 53) % 100) / 100) * (1 - side);
        return [
          e.w + (e.e - e.w) * fx,
          e.s + (e.n - e.s) * fy,
          e.w + (e.e - e.w) * (fx + side),
          e.s + (e.n - e.s) * (fy + side),
        ] as const;
      });
    const args = (b: Box): number[] => [b[2], b[0], b[3], b[1]];
    const oldBbox = (b: Box): number =>
      db
        .prepare(
          `SELECT f.id AS id, f.type AS type FROM feature_bbox r JOIN features f ON f.rowid = r.rid WHERE ${OLD_NEAR} ORDER BY f.id`,
        )
        .all(...args(b)).length;
    const newBbox = (b: Box): number => bboxQuery(db as Db, b as never).length;
    const oldPage = (b: Box): number =>
      db
        .prepare(
          `SELECT f.rowid AS rid, f.id, f.type, f.properties, f.geometry FROM features f JOIN feature_bbox r ON r.rid = f.rowid
           WHERE f.type = ? AND f.lifecycle IN ('active','completed') AND f.rowid > ? AND ${OLD_NEAR} AND 1=1 ORDER BY f.rowid LIMIT ?`,
        )
        .all('baum', 0, ...args(b), 101)
        .slice(0, 100).length;
    const crossPage = (b: Box): number =>
      db
        .prepare(
          `SELECT f.rowid AS rid, f.id, f.type, f.properties, f.geometry FROM feature_bbox r CROSS JOIN features f ON f.rowid = r.rid
           WHERE f.type = ? AND f.lifecycle IN ('active','completed') AND f.rowid > ? AND ${OLD_NEAR} AND 1=1 ORDER BY f.rowid LIMIT ?`,
        )
        .all('baum', 0, ...args(b), 101)
        .slice(0, 100).length;
    const newPage = (b: Box): number => {
      const r = readPage(db as Db, {
        type: 'baum',
        visible: { sql: '1=1', params: [] },
        limit: 100,
        after: 0,
        bbox: b as never,
      });
      return r.ok ? r.page.rows.length : -1;
    };
    const lines: string[] = [];
    const p95s = new Map<string, number>();
    const measure = (label: string, run: (b: Box) => number, set: Box[]): number => {
      for (const b of set.slice(0, 5)) run(b);
      const ts: number[] = [];
      for (const b of set) {
        const t = performance.now();
        run(b);
        ts.push(performance.now() - t);
      }
      const row = `${label}: median ${median(ts).toFixed(2)} ms, p95 ${p95(ts).toFixed(2)} ms`;
      lines.push(row);
      p95s.set(label, p95(ts));
      return median(ts);
    };
    for (const indexed of [false, true]) {
      if (indexed) {
        db.exec("CREATE INDEX cfg_idx_probe ON features (type, json_extract(properties, '$.stage'))");
        db.exec('ANALYZE');
      }
      for (const share of [0.01, 0.1, 1]) {
        const set = boxes(share, share === 1 ? 20 : 150);
        const tag = `${indexed ? 'idx' : 'noidx'} ${(share * 100).toFixed(0)}%`;
        expect(oldBbox(set[0] as Box)).toBe(newBbox(set[0] as Box));
        expect(oldPage(set[0] as Box)).toBe(crossPage(set[0] as Box));
        expect(oldPage(set[0] as Box)).toBe(newPage(set[0] as Box));
        for (let round = 0; round < 2; round++) {
          measure(`${tag} bboxQuery plain JOIN`, oldBbox, set);
          measure(`${tag} bboxQuery viewportFrom`, newBbox, set);
          measure(`${tag} items page CROSS JOIN`, crossPage, set);
          measure(`${tag} items page viewportPageFrom`, newPage, set);
        }
      }
    }
    const out = process.env['VIEWPORT_SHAPES_OUT'];
    if (out !== undefined) writeFileSync(out, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    const judge = (id: string, label: string): void => {
      assertBudget(
        report(
          defineBudget({
            id,
            limit: 100,
            unit: 'ms',
            row: 'bbox-query-p95',
            device: 'server',
          }),
          Number((p95s.get(label) as number).toFixed(1)),
        ),
      );
    };
    // With a config index on features (what a deployed project has).
    judge('server-items-page-10pct-p95', 'idx 10% items page viewportPageFrom');
    judge('server-items-page-100pct-p95', 'idx 100% items page viewportPageFrom');
    judge('server-bbox-query-10pct-p95', 'idx 10% bboxQuery viewportFrom');
    db.close();
  }, 300_000);
});
