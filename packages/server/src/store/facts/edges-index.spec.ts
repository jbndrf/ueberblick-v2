import type { Edge, FeatureId, Key } from '@ueberblick/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openSqlite } from '../../db/driver';
import { migrate } from '../../db/migrate';
import { PROJECT_MIGRATIONS } from '../../db/project-schema';
import { createFacts } from './index';
import { openDb } from './sqlite.testkit';

const IDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const RELS = ['plot', 'area_of', 'owner'] as const;
const edgeArb = fc.record({
  from: fc.constantFrom(...IDS),
  relation: fc.constantFrom(...RELS),
  to: fc.constantFrom(...IDS),
  derived: fc.boolean(),
});
const worldArb = fc.record({
  edges: fc.array(edgeArb, { maxLength: 30 }),
  dead: fc.subarray([...IDS]),
  missing: fc.subarray([...IDS]),
});

const byte = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: Edge, b: Edge, far: 'from' | 'to'): number =>
  byte(a.relation, b.relation) || byte(a[far], b[far]);

describe('edgesFrom / edgesTo over the edges indexes (WP-179)', () => {
  it('equal a brute-force read of the stored rows: live far ends only, in relation and far-id order', () => {
    fc.assert(
      fc.property(worldArb, ({ edges, dead, missing }) => {
        const db = openDb();
        const facts = createFacts(db, new Map());
        for (const id of IDS) {
          if (missing.includes(id)) continue;
          db.prepare(
            `INSERT INTO features (id, type, config_version, properties, updated_seq, lifecycle) VALUES (?, 't', 1, '{}', 1, ?)`,
          ).run(id, dead.includes(id) ? 'deleted' : 'active');
        }
        const seen = new Set<string>();
        const stored: Edge[] = [];
        for (const e of edges) {
          const key = `${e.from}|${e.relation}|${e.to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          db.prepare(
            'INSERT INTO edges (from_id, relation, to_id, derived, updated_seq) VALUES (?, ?, ?, ?, 1)',
          ).run(e.from, e.relation, e.to, e.derived ? 1 : 0);
          stored.push({
            from: e.from as FeatureId,
            relation: e.relation as Key,
            to: e.to as FeatureId,
            derived: e.derived,
          });
        }
        const live = (id: FeatureId): boolean =>
          !missing.includes(id as never) && !dead.includes(id as never);
        for (const id of IDS) {
          const out = stored.filter((e) => e.from === id && live(e.to)).sort((a, b) => order(a, b, 'to'));
          const inn = stored.filter((e) => e.to === id && live(e.from)).sort((a, b) => order(a, b, 'from'));
          expect(facts.edgesFrom(id as FeatureId)).toEqual(out);
          expect(facts.edgesTo(id as FeatureId)).toEqual(inn);
          for (const r of RELS) {
            expect(facts.edgesFrom(id as FeatureId, r as Key)).toEqual(out.filter((e) => e.relation === r));
            expect(facts.edgesTo(id as FeatureId, r as Key)).toEqual(inn.filter((e) => e.relation === r));
          }
        }
        db.close();
      }),
      { numRuns: 60 },
    );
  });

  it('edgesTo(relation) is one covering index search with no temp sort', () => {
    const db = openDb();
    const plan = db
      .prepare<{ detail: string }>(
        `EXPLAIN QUERY PLAN SELECT e.from_id, e.relation, e.to_id, e.derived FROM edges e
         JOIN features f ON f.id = e.from_id WHERE e.to_id = ? AND e.relation = ? AND f.lifecycle IN ('active','completed') ORDER BY e.from_id`,
      )
      .all('x', 'plot')
      .map((r) => r.detail)
      .join(' | ');
    expect(plan).toContain('COVERING INDEX edges_by_to');
    expect(plan).not.toContain('TEMP B-TREE');
    db.close();
  });
});

describe('upgrading an existing db (migration 9)', () => {
  it('widens edges_by_to to the covering index and leaves the edges rows untouched', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 9),
    );
    const ins = db.prepare(
      'INSERT INTO edges (from_id, relation, to_id, derived, updated_seq) VALUES (?, ?, ?, ?, 1)',
    );
    ins.run('a', 'plot', 'b', 0);
    ins.run('b', 'area_of', 'a', 1);
    ins.run('c', 'owner', 'a', 0);
    // scoped to migration 9: a pre-9 db of today also receives the later migrations (WP-594 migration 10, …)
    expect(
      migrate(
        db,
        PROJECT_MIGRATIONS.filter((m) => m.id <= 9),
      ),
    ).toEqual([9]);
    expect(
      db
        .prepare<{ seqno: number; name: string }>('PRAGMA index_info(edges_by_to)')
        .all()
        .sort((x, y) => x.seqno - y.seqno)
        .map((r) => r.name),
    ).toEqual(['to_id', 'relation', 'from_id', 'derived']);
    expect(
      db
        .prepare<{ n: number }>(
          "SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'edges_by_to'",
        )
        .get()?.n,
    ).toBe(1);
    expect(
      db
        .prepare(
          'SELECT from_id, relation, to_id, derived, updated_seq FROM edges ORDER BY from_id, relation, to_id',
        )
        .all(),
    ).toEqual([
      { from_id: 'a', relation: 'plot', to_id: 'b', derived: 0, updated_seq: 1 },
      { from_id: 'b', relation: 'area_of', to_id: 'a', derived: 1, updated_seq: 1 },
      { from_id: 'c', relation: 'owner', to_id: 'a', derived: 0, updated_seq: 1 },
    ]);
    expect(
      migrate(
        db,
        PROJECT_MIGRATIONS.filter((m) => m.id <= 9),
      ),
    ).toEqual([]);
    db.close();
  });
});
