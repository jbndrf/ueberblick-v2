import fc from 'fast-check';
import { isServed } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import {
  createFold,
  createGeo,
  edgeKey,
  type FeatureId,
  type FoldedFeature,
  type Json,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import { createFoldWriter } from '../store/facts';
import { ob, openDb, point, SCHEMA, square } from '../store/facts/sqlite.testkit';
import { createDerive } from './index';

const geo = createGeo();
const fold = createFold(geo);
const noCondition = (): boolean => {
  throw new Error('no derive condition in this schema');
};

/** trees 0..3 (points), areas 4..6 (squares, some with a hole). */
const IDS = ['t0', 't1', 't2', 't3', 'a0', 'a1', 'a2'];
const TYPE = (i: number): string => (i < 4 ? 'tree' : 'area');

interface Move {
  readonly f: number;
  readonly x: number;
  readonly y: number;
  readonly d: number;
  readonly hole: boolean;
  readonly gone: boolean;
}
const move: fc.Arbitrary<Move> = fc.record({
  f: fc.nat(6),
  x: fc.nat(4),
  y: fc.nat(4),
  d: fc.integer({ min: 2, max: 4 }),
  hole: fc.boolean(),
  gone: fc.oneof(fc.constant(false), fc.constant(false), fc.constant(true)),
});

/** A square; with `hole` an inner unit square with integer corners, so points meet its boundary often. */
function polygon(m: Move): Json {
  const outer = square(m.x, m.y, m.d) as { coordinates: Json[] };
  if (!m.hole || m.d < 3) return outer as Json;
  const h = square(m.x + 1, m.y + 1, 1) as { coordinates: Json[] };
  return { type: 'Polygon', coordinates: [outer.coordinates[0] as Json, h.coordinates[0] as Json] };
}

/** Writes features through the fold and `createFoldWriter` WITHOUT derived edges: the state derive must repair. */
function apply(db: Db, state: Map<string, FoldedFeature>, moves: readonly Move[], seq0: number): number {
  let seq = seq0;
  const touched = new Set<string>();
  for (const m of moves) {
    const id = IDS[m.f] as string;
    const obs = [
      ...(state.has(id) ? [] : [ob(id, '$type', TYPE(m.f), ++seq)]),
      ob(id, 'geometry', m.f < 4 ? point(m.x, m.y) : polygon(m), ++seq),
      ob(id, '$lifecycle', m.gone ? 'deleted' : 'active', ++seq),
    ];
    const r = fold.feature(state.get(id), obs, SCHEMA);
    if (r.feature === undefined) continue;
    state.set(id, r.feature);
    touched.add(id);
  }
  const features = [...touched].map((id) => state.get(id) as FoldedFeature);
  createFoldWriter(db).apply({
    configVersion: 1,
    schema: SCHEMA,
    features,
    edges: { put: [], remove: [] },
    seq,
  });
  return seq;
}

/** Every live tree against every live area, the obvious way. */
function brute(state: ReadonlyMap<string, FoldedFeature>): string[] {
  const out: string[] = [];
  for (const t of state.values())
    for (const a of state.values()) {
      if (t.type !== 'tree' || a.type !== 'area' || !isServed(t.lifecycle) || !isServed(a.lifecycle))
        continue;
      const tg = t.properties['geometry'];
      const ag = a.properties['geometry'];
      if (tg && ag && geo.test('within', tg as never, ag as never))
        out.push(edgeKey({ from: t.id, relation: 'area_of' as never, to: a.id }));
    }
  return out.sort();
}

const stored = (db: Db): string[] =>
  db
    .prepare<{ f: string; r: string; t: string }>(
      "SELECT from_id AS f, relation AS r, to_id AS t FROM edges WHERE relation = 'area_of' AND derived = 1",
    )
    .all()
    .map((e) => edgeKey({ from: e.f as FeatureId, relation: e.r as never, to: e.t as FeatureId }))
    .sort();

const derive = (db: Db) =>
  createDerive(db, { geo, deployed: () => 1, at: () => ({ schema: SCHEMA, condition: noCondition }) });
const ids = (list: readonly number[]): FeatureId[] => list.map((i) => IDS[i] as FeatureId);
const box = (f: number, x: number, y: number, d = 4): Move => ({ f, x, y, d, hole: false, gone: false });

describe('derive.recompute', () => {
  it('equals a brute-force recomputation after every batch (property, holes and boundaries)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(move, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 6 }),
        (batches) => {
          const db = openDb();
          const state = new Map<string, FoldedFeature>();
          let seq = 0;
          const d = derive(db);
          for (const batch of batches) {
            seq = apply(db, state, batch, seq);
            d.recompute(ids([...new Set(batch.map((m) => m.f))]));
            expect(stored(db)).toEqual(brute(state));
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('recomputing every feature at once repairs a store that has no derived edges', () => {
    fc.assert(
      fc.property(fc.array(move, { minLength: 1, maxLength: 12 }), (moves) => {
        const db = openDb();
        const state = new Map<string, FoldedFeature>();
        apply(db, state, moves, 0);
        derive(db).recompute(ids([0, 1, 2, 3, 4, 5, 6]));
        expect(stored(db)).toEqual(brute(state));
      }),
      { numRuns: 100 },
    );
  });

  it('a point on a boundary is within, a point in a hole is not', () => {
    const db = openDb();
    const state = new Map<string, FoldedFeature>();
    const area: Move = { f: 4, x: 0, y: 0, d: 4, hole: true, gone: false };
    // t0 on the outer boundary, t1 inside, t2 in the hole, t3 on the hole's boundary
    apply(db, state, [area, box(0, 0, 2, 1), box(1, 3, 3, 1), box(2, 1.5, 1.5, 1), box(3, 1, 1, 1)], 0);
    derive(db).recompute(ids([0, 1, 2, 3, 4]));
    expect(stored(db)).toEqual(brute(state));
    expect(stored(db).length).toBeGreaterThan(0);
    expect(stored(db).length).toBeLessThan(4);
  });

  it('a removed edge leaves a tombstone, and puts are stamped with the given seq', () => {
    const db = openDb();
    const state = new Map<string, FoldedFeature>();
    let seq = apply(db, state, [box(4, 0, 0), box(0, 2, 2, 1)], 0);
    const first = derive(db).recompute(ids([0, 4]), seq + 1);
    expect(first.put).toBe(1);
    expect(
      db.prepare<{ s: number }>("SELECT updated_seq AS s FROM edges WHERE relation = 'area_of'").get()?.s,
    ).toBe(seq + 1);
    seq = apply(db, state, [box(0, 9, 9, 1)], seq);
    const second = derive(db).recompute(ids([0]));
    expect(second.remove).toBe(1);
    expect(stored(db)).toEqual([]);
    expect(db.prepare("SELECT id FROM tombstones WHERE kind = 'edge'").all()).toHaveLength(1);
  });

  it('an unknown id is skipped', () => {
    expect(derive(openDb()).recompute(['nope' as FeatureId])).toEqual({ put: 0, remove: 0 });
  });

  it('a second recompute changes nothing', () => {
    const db = openDb();
    const state = new Map<string, FoldedFeature>();
    apply(db, state, [box(4, 0, 0), box(0, 1, 1, 1), box(1, 2, 2, 1)], 0);
    const d = derive(db);
    expect(d.recompute(ids([0, 1, 4])).put).toBe(2);
    expect(d.recompute(ids([0, 1, 4]))).toEqual({ put: 0, remove: 0 });
  });
});
