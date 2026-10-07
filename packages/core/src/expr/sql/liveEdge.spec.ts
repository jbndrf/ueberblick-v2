/** liveEdgeJoin: the one "far end is a live feature" rule, against real SQLite and as exported for the server. */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import * as compile from '../compile';
import { WORLD_DDL } from '../__fixtures__/sql-world';
import { liveEdgeJoin } from './liveEdge';
import { relationFrom, type Row } from './values';

const db = new Database(':memory:');
for (const ddl of WORLD_DDL) db.exec(ddl);
const feature = db.prepare('INSERT INTO features (id, type, properties, lifecycle) VALUES (?, ?, ?, ?)');
feature.run('a', 't', '{}', 'active');
feature.run('live', 't', '{}', 'active');
feature.run('dead', 't', '{}', 'deleted');
const edge = db.prepare('INSERT INTO edges (from_id, relation, to_id) VALUES (?, ?, ?)');
for (const [f, t] of [
  ['a', 'live'],
  ['a', 'dead'],
  ['a', 'ghost'],
  ['live', 'a'],
  ['dead', 'a'],
  ['ghost', 'a'],
] as const)
  edge.run(f, 'r', t);

/** The way the server uses it: `FROM edges e <join> WHERE e.<near> = ? AND <live>`. */
function farEnds(direction: 'out' | 'in', id: string): string[] {
  const j = liveEdgeJoin({ edge: 'e', feature: 'f', direction });
  const rows = db
    .prepare(`SELECT f.id AS id FROM edges e ${j.join} WHERE e.${j.near} = ? AND ${j.live} ORDER BY f.id`)
    .all(id) as { id: string }[];
  return rows.map((r) => r.id);
}

describe('liveEdgeJoin', () => {
  it('outgoing edges keep only live far ends (never-created and deleted are excluded)', () => {
    expect(farEnds('out', 'a')).toEqual(['live']);
  });

  it('incoming edges keep only live far ends (never-created and deleted are excluded)', () => {
    expect(farEnds('in', 'a')).toEqual(['live']);
  });

  it('names the columns of each direction', () => {
    expect(liveEdgeJoin({ edge: 'e', feature: 'f', direction: 'out' })).toEqual({
      join: 'JOIN features f ON f.id = e.to_id',
      live: "f.lifecycle IN ('active','completed')",
      near: 'from_id',
      far: 'to_id',
    });
    expect(liveEdgeJoin({ edge: 'x', feature: 'y', direction: 'in' })).toEqual({
      join: 'JOIN features y ON y.id = x.from_id',
      live: "y.lifecycle IN ('active','completed')",
      near: 'to_id',
      far: 'from_id',
    });
  });

  it('is what relationFrom is built from: identical SQL to the pre-fragment text', () => {
    const parent: Row = { kind: 'root', alias: 'p' };
    expect(relationFrom(parent, 'r', false, 'f', 'e').sql).toBe(
      "FROM edges e JOIN features f ON f.id = e.to_id WHERE e.from_id = p.id AND e.relation = ? AND f.lifecycle IN ('active','completed')",
    );
    expect(relationFrom(parent, 'r', true, 'f', 'e').sql).toBe(
      "FROM edges e JOIN features f ON f.id = e.from_id WHERE e.to_id = p.id AND e.relation = ? AND f.lifecycle IN ('active','completed')",
    );
  });

  it.each(['x; DROP TABLE features', '', '1a', "e' OR 1=1", 'a.b'])('refuses the alias %j', (bad) => {
    expect(() => liveEdgeJoin({ edge: bad, feature: 'f', direction: 'out' })).toThrow(/edge alias/);
    expect(() => liveEdgeJoin({ edge: 'e', feature: bad, direction: 'in' })).toThrow(/feature alias/);
  });

  it('is exported through core/expr/compile', () => {
    expect(compile.liveEdgeJoin).toBe(liveEdgeJoin);
  });
});
