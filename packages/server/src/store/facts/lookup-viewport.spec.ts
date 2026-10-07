/** WP-591: the server's viewport reads use core `viewportFrom`; results equal the old plain join. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Bbox } from '@ueberblick/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';
import type { Db } from '../../db/driver';
import { bboxQuery, createFacts } from './index';
import { INVERSE, Model, ingest, k, ob, openDb, point, square } from './sqlite.testkit';

const SERVER_SRC = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (isPlanted(n)) return [];
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(n) && !/(^|\.)(spec|testkit|bench)\.ts$/.test(n) ? [p] : [];
  });
}

/** The files that may name the table: its DDL and the fold writer that maintains it (grep feature_bbox in src). */
const ALLOWED: Record<string, true> = {
  'db/project-schema.ts': true,
  'store/facts/apply.ts': true,
};

/**
 * Strips the line and block comments of `text` (a `//` or `/*` inside a string or template literal is
 * not a comment start) and says whether the remainder, string and template contents included, names
 * `feature_bbox`: a hand-written join, or any other hand-rolled statement on the table.
 */
function namesTable(text: string): boolean {
  let out = '';
  let quote: string | undefined;
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    const d = i + 1 < text.length ? (text[i + 1] as string) : '';
    if (quote !== undefined) {
      if (c === '\\' && d !== '') {
        out += c + d;
        i += 2;
      } else {
        out += c;
        if (c === quote) quote = undefined;
        i += 1;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      const nl = text.indexOf('\n', i);
      out += nl === -1 ? ' ' : '\n';
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return /\bfeature_bbox\b/.test(out);
}

/** The plain join of before WP-591, kept here as the reference. */
const OLD = 'r.minx <= ? AND r.maxx >= ? AND r.miny <= ? AND r.maxy >= ?';
const oldIds = (db: Db, b: Bbox, type?: string): string[] =>
  db
    .prepare<{ id: string }>(
      `SELECT f.id AS id FROM feature_bbox r JOIN features f ON f.rowid = r.rid
       WHERE ${OLD}${type === undefined ? '' : ' AND f.type = ?'} ORDER BY f.id`,
    )
    .all(...[b[2], b[0], b[3], b[1], ...(type === undefined ? [] : [type])])
    .map((r) => r.id);

describe('viewport reads of the server store (WP-591)', () => {
  it('no server source names feature_bbox except its DDL and the fold writer: viewportFrom is the one text', () => {
    const offenders = sources(SERVER_SRC).filter((f) => {
      const rel = relative(SERVER_SRC, f);
      return ALLOWED[rel] === undefined && namesTable(readFileSync(f, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('the guard flags every hand-written join, ignores comments and exempts the maintainers', () => {
    // The three forms the old regex missed.
    expect(namesTable('SELECT f.id FROM feature_bbox JOIN features f ON f.rowid = r.rid')).toBe(true);
    expect(namesTable('SELECT f.id FROM feature_bbox AS r JOIN features f ON f.rowid = r.rid')).toBe(true);
    expect(namesTable('SELECT f.id FROM features f, feature_bbox r WHERE r.rid = f.rowid')).toBe(true);
    // A comment mention is not a hand-written join.
    expect(namesTable('// feature_bbox is maintained by the fold writer\nconst x = 1;')).toBe(false);
    expect(
      namesTable('/* feature_bbox holds the union bbox of all geometry properties */\nconst y = 2;'),
    ).toBe(false);
    // The maintainers may name the table; no other file may.
    const ddl = 'CREATE VIRTUAL TABLE feature_bbox USING rtree (rid, minx, maxx, miny, maxy);';
    for (const rel of Object.keys(ALLOWED)) expect(ALLOWED[rel] === undefined && namesTable(ddl)).toBe(false);
    expect(ALLOWED['store/facts/lookup.ts'] === undefined && namesTable(ddl)).toBe(true);
  });

  it('the guard checks string and template contents, where real hand-written SQL lives', () => {
    // Real SQL lives in template literals and strings: the contents are checked.
    const tpl = 'const q = `SELECT f.id FROM feature_bbox JOIN features f ON f.rowid = r.rid`;';
    const single = "const s = '… feature_bbox AS r JOIN features …'";
    const multi = 'const q = `SELECT * FROM features f,\n feature_bbox r WHERE f.rowid = r.rid`;';
    const afterComment = '/* note */ const q = `SELECT * FROM feature_bbox b JOIN features f`;';
    expect(namesTable(tpl)).toBe(true);
    expect(namesTable(single)).toBe(true);
    expect(namesTable(multi)).toBe(true);
    expect(namesTable(afterComment)).toBe(true);
    // A comment may name the table; code may not.
    expect(namesTable('// feature_bbox is maintained by apply.ts')).toBe(false);
    expect(namesTable('/* feature_bbox */')).toBe(false);
  });

  it('bboxQuery, Facts.near and the derived lookup return what the plain join returned', () => {
    const coord = fc.integer({ min: -40, max: 40 });
    const boxArb = fc
      .tuple(coord, coord, fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 50 }))
      .map(([x, y, w, h]): Bbox => [x, y, x + w, y + h]);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(coord, coord, fc.boolean()), { maxLength: 30 }),
        fc.array(boxArb, { minLength: 1, maxLength: 5 }),
        (pts, boxes) => {
          const db = openDb();
          const obs = pts.flatMap(([x, y, isArea], i) => [
            ob(`f${i}`, '$type', isArea ? 'area' : 'tree', 2 * i + 1),
            ob(`f${i}`, 'geometry', isArea ? square(x, y, 3) : point(x, y), 2 * i + 2),
          ]);
          ingest(db, new Model(), obs, 10);
          const facts = createFacts(db, INVERSE);
          for (const b of boxes) {
            expect(bboxQuery(db, b).map((h) => h.id)).toEqual(oldIds(db, b));
            expect(bboxQuery(db, b, 'tree').map((h) => h.id)).toEqual(oldIds(db, b, 'tree'));
            const near = [...facts.near(k('area'), b)].map((f) => f.id as string).sort();
            expect(near).toEqual(oldIds(db, b, 'area'));
          }
          db.close();
        },
      ),
      { numRuns: 40 },
    );
  });

  it('the R*Tree drives the viewport even when a filter index on features exists', () => {
    const db = openDb();
    const obs = Array.from({ length: 200 }, (_, i) => [
      ob(`f${i}`, '$type', 'tree', 2 * i + 1),
      ob(`f${i}`, 'geometry', point(i % 20, Math.floor(i / 20)), 2 * i + 2),
    ]).flat();
    ingest(db, new Model(), obs, 50);
    db.exec("CREATE INDEX cfg_idx_probe ON features (type, json_extract(properties, '$.probe'))");
    db.exec('ANALYZE');
    const plan = (sql: string): string =>
      db
        .prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(1, 0, 1, 0, 'tree')
        .map((r) => r.detail)
        .join(' | ');
    // The exact statement text of the two lookup.ts sources, through their public behaviour: a spy on prepare.
    const seen: string[] = [];
    const spy = { ...db, prepare: ((sql: string) => (seen.push(sql), db.prepare(sql))) as Db['prepare'] };
    bboxQuery(spy as Db, [0, 0, 1, 1], 'tree');
    expect(seen).toHaveLength(1);
    expect(plan(seen[0] as string)).toMatch(/^SCAN \w+ VIRTUAL TABLE/);
    db.close();
  });
});
