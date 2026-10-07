/**
 * viewportFrom (WP-590): the viewport join that lets the R*Tree drive. The result must equal the plain `JOIN`
 * (the old shape) for any filter and bbox, and SQLite must scan the R*Tree first.
 */
import Database from 'better-sqlite3';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Bbox } from '../../geo/contract';
import { T, check, type Env } from '../check';
import { parse } from '../parse';
import { propertySql, toSql } from './index';
import { viewportFrom, viewportPageFrom } from './viewport';

const env: Env = {
  vars: { self: { kind: 'feature', type: 'baum' } },
  features: { baum: { stage: T.string, hoehe_m: T.double, art: T.string } },
};
const STAGES = ['erfasst', 'kontrolliert', 'massnahme', 'erledigt'];
const ARTS = ['Linde', 'Eiche', 'Ahorn'];

function translate(src: string): { sql: string; params: (string | number)[] } {
  const p = parse(src);
  if (!p.ok) throw new Error(src);
  const c = check(p.ast, env, { expect: T.bool });
  if (!c.ok) throw new Error(src);
  const r = toSql(c.typed, { self: 'f', vars: new Map() });
  if (!r.ok) throw new Error(r.unsupported.reason);
  return { sql: r.sql, params: r.params as (string | number)[] };
}

function store(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE features (id TEXT PRIMARY KEY, type TEXT NOT NULL, properties TEXT NOT NULL,
    lifecycle TEXT NOT NULL DEFAULT 'active');
    CREATE VIRTUAL TABLE feature_bbox USING rtree (rid, minx, maxx, miny, maxy)`);
  for (const k of ['stage', 'hoehe_m'])
    db.exec(`CREATE INDEX cfg_idx_${k} ON features (type, ${propertySql('', k)})`);
  const ins = db.prepare('INSERT INTO features (id, type, properties, lifecycle) VALUES (?, ?, ?, ?)');
  const box = db.prepare('INSERT INTO feature_bbox (rid, minx, maxx, miny, maxy) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 600; i++) {
    const props = { stage: STAGES[i % 4], hoehe_m: (i * 7) % 30, art: ARTS[i % 3] };
    const id = Number(
      ins.run(
        `f${i}`,
        i % 5 === 0 ? 'flaeche' : 'baum',
        JSON.stringify(props),
        i % 11 === 0 ? 'deleted' : 'active',
      ).lastInsertRowid,
    );
    const x = (i * 37) % 100;
    const y = (i * 53) % 100;
    box.run(id, x, x + (i % 3), y, y + (i % 2));
  }
  return db;
}

const TERMS = [
  "self.stage == 'kontrolliert'",
  "self.stage == 'erfasst'",
  "self.stage == 'nix'",
  'self.hoehe_m > 15.0',
  'self.hoehe_m <= 4.0',
  "self.art.startsWith('L')",
  "self.art in ['Eiche', 'Ahorn']",
];

const old = (db: Database.Database, f: { sql: string; params: (string | number)[] }, b: Bbox): string[] =>
  db
    .prepare<(string | number)[], { id: string }>(
      `SELECT f.id AS id FROM feature_bbox r JOIN features f ON f.rowid = r.rid
       WHERE r.minx <= ? AND r.maxx >= ? AND r.miny <= ? AND r.maxy >= ? AND f.type = 'baum' AND f.lifecycle IN ('active','completed') AND ${f.sql}`,
    )
    .all(b[2], b[0], b[3], b[1], ...f.params)
    .map((r) => r.id)
    .sort();

const fresh = (db: Database.Database, f: { sql: string; params: (string | number)[] }, b: Bbox): string[] => {
  const v = viewportFrom({ feature: 'f', box: 'r' });
  return db
    .prepare<(string | number)[], { id: string }>(
      `SELECT f.id AS id ${v.from} WHERE ${v.near} AND f.type = 'baum' AND f.lifecycle IN ('active','completed') AND ${f.sql}`,
    )
    .all(...v.args(b), ...f.params)
    .map((r) => r.id)
    .sort();
};

describe('viewportFrom', () => {
  const db = store();

  it('gives the same features as the plain join for random filters and bboxes (property)', () => {
    const coord = fc.integer({ min: -5, max: 105 });
    fc.assert(
      fc.property(
        fc.subarray(TERMS, { minLength: 1 }),
        fc.constantFrom(' && ', ' || '),
        coord,
        coord,
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (terms, op, x, y, w, h) => {
          const f = translate(terms.join(op));
          const b: Bbox = [x, y, x + w, y + h];
          expect(fresh(db, f, b)).toEqual(old(db, f, b));
        },
      ),
      { numRuns: 150 },
    );
  });

  it('gives a non-empty result on a real viewport (the comparison is not vacuous)', () => {
    expect(fresh(db, translate("self.stage == 'kontrolliert'"), [0, 0, 60, 60]).length).toBeGreaterThan(0);
  });

  it('lets the R*Tree drive: it is scanned first, features are fetched by rowid', () => {
    const f = translate("self.stage == 'kontrolliert' && self.hoehe_m > 15.0");
    const v = viewportFrom({ feature: 'f', box: 'r' });
    const plan = db
      .prepare<(string | number)[], { detail: string }>(
        `EXPLAIN QUERY PLAN SELECT f.id ${v.from} WHERE ${v.near} AND f.type = 'baum' AND ${f.sql}`,
      )
      .all(...v.args([0, 0, 50, 50]), ...f.params)
      .map((r) => r.detail);
    expect(plan[0]).toContain('VIRTUAL TABLE');
    expect(plan[1]).toContain('INTEGER PRIMARY KEY');
  });

  it('rejects an alias that is not a plain identifier', () => {
    expect(() => viewportFrom({ feature: 'f; DROP', box: 'r' })).toThrow(/identifier/);
  });

  it('viewportPageFrom returns the same row set as viewportFrom, and walks features in rowid order (property)', () => {
    const coord = fc.integer({ min: -5, max: 105 });
    const page = (f: { sql: string; params: (string | number)[] }, b: Bbox): string[] => {
      const v = viewportPageFrom({ feature: 'f', box: 'r' });
      return db
        .prepare<(string | number)[], { id: string }>(
          `SELECT f.id AS id ${v.from} WHERE ${v.near} AND f.type = 'baum' AND f.lifecycle IN ('active','completed') AND ${f.sql}`,
        )
        .all(...v.args(b), ...f.params)
        .map((r) => r.id)
        .sort();
    };
    fc.assert(
      fc.property(
        fc.subarray(TERMS, { minLength: 1 }),
        coord,
        coord,
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (terms, x, y, w, h) => {
          const f = translate(terms.join(' && '));
          const b: Bbox = [x, y, x + w, y + h];
          expect(page(f, b)).toEqual(fresh(db, f, b));
        },
      ),
      { numRuns: 100 },
    );
    const v = viewportPageFrom({ feature: 'f', box: 'r' });
    expect(v.from).toBe('FROM features f JOIN feature_bbox r ON r.rid = f.rowid');
    expect(() => viewportPageFrom({ feature: 'f x', box: 'r' })).toThrow(/identifier/);
  });
});
