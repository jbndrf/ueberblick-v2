import type { Bbox, FoldedFeature } from '@ueberblick/core';
import { describeFactsConformance, type FactsHarness } from '@ueberblick/core/testing';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { bboxQuery, createFacts, createFoldWriter } from './index';
import {
  INVERSE,
  Model,
  op,
  toLog,
  SCHEMA,
  dump,
  fid,
  ingest,
  k,
  ob,
  openDb,
  point,
  square,
} from './sqlite.testkit';

/** The SQLite Facts as the conformance suite drives them: fold through `createFoldWriter`, read through `createFacts`. */
function sqlite(): FactsHarness {
  const db = openDb();
  const model = new Model();
  const facts = createFacts(db, INVERSE);
  return {
    facts,
    related: (id, relation) => facts.related(id, relation),
    apply: (observations, chunk = observations.length || 1) => ingest(db, model, observations, chunk),
    applyBy(actorId, observations) {
      const run = observations[0]?.runId;
      if (run === undefined) return;
      db.prepare(
        `INSERT OR IGNORE INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
         VALUES (?, ?, 'participant', 't', 1, '{}', '2026-01-01T00:00:00.000Z', 'accepted')`,
      ).run(run, actorId);
      ingest(db, model, observations, observations.length);
    },
    dispose: () => db.close(),
  };
}

describeFactsConformance('SQLite Facts', sqlite);

describe('related with a dangling edge row', () => {
  it('does not return an edge whose near or far end is missing from features (core SQL: inner JOIN)', () => {
    const db = openDb();
    ingest(db, new Model(), [ob('p9', '$type', 'plot', 3), ob('p9', 'code', 'p9', 4)], 10);
    db.prepare(
      "INSERT INTO edges (from_id, relation, to_id, derived, updated_seq) VALUES ('gone', 'plot', 'p9', 0, 5)",
    ).run();
    const facts = createFacts(db, INVERSE);
    expect(facts.related(fid('p9'), k('trees'))).toEqual([]);
    expect(facts.edgesTo(fid('p9'), k('plot'))).toEqual([]);
  });
});

describe('rebuild', () => {
  it('apply(fold(log)) in chunks equals a rebuild from the whole log', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), fc.integer({ min: 1, max: 25 }), (ops, chunk) => {
        const log = toLog(ops);
        const a = openDb();
        ingest(a, new Model(), log, chunk);
        const b = openDb();
        ingest(b, new Model(), log, log.length);
        expect(dump(a)).toEqual(dump(b));
        // bbox rows exist exactly for live features with a geometry
        const live = a
          .prepare<{ n: number }>(
            "SELECT count(*) AS n FROM features WHERE lifecycle IN ('active','completed') AND geometry IS NOT NULL",
          )
          .get();
        const boxes = a.prepare<{ n: number }>('SELECT count(*) AS n FROM feature_bbox').get();
        expect(boxes?.n).toBe(live?.n);
        a.close();
        b.close();
      }),
      { numRuns: 60 },
    );
  });
});

describe('createFoldWriter', () => {
  it('prepares its statements once per writer, not per apply', () => {
    const db = openDb();
    const prepare = vi.spyOn(db, 'prepare');
    const writer = createFoldWriter(db);
    const prepared = prepare.mock.calls.length;
    expect(prepared).toBeGreaterThan(0);
    const batch = { configVersion: 1, schema: SCHEMA, features: [], edges: { put: [], remove: [] }, seq: 1 };
    for (let i = 0; i < 100; i++) writer.apply(batch);
    expect(prepare.mock.calls.length).toBe(prepared);
  });

  it('is idempotent and keeps Z in the stored geometry', () => {
    const db = openDb();
    const model = new Model();
    ingest(db, model, [ob('t0', '$type', 'tree', 1), ob('t0', 'geometry', point(1, 2, 35.5), 2)], 10);
    const before = dump(db);
    const f = model.features.get(fid('t0')) as FoldedFeature;
    createFoldWriter(db).apply({
      configVersion: 1,
      schema: SCHEMA,
      features: [f],
      edges: { put: [], remove: [] },
      seq: 2,
    });
    expect(dump(db)).toBe(before);
    const row = db
      .prepare<{ geometry: string; anchor_lon: number }>('SELECT geometry, anchor_lon FROM features')
      .get();
    expect(JSON.parse(row?.geometry ?? 'null')).toEqual(point(1, 2, 35.5));
    expect(row?.anchor_lon).toBe(1);
  });

  it('stores the declared primary geometry, not the first one with a value (B-009)', () => {
    const db = openDb();
    ingest(
      db,
      new Model(),
      [
        ob('m0', '$type', 'multi', 1),
        ob('m0', 'aaa_extra', point(9, 9), 2),
        ob('m0', 'footprint', square(0, 0, 2), 3),
        ob('n0', '$type', 'multi', 4),
        ob('n0', 'aaa_extra', point(50, 50), 5),
      ],
      10,
    );
    const row = (id: string) =>
      db
        .prepare<{ geometry: string | null; anchor_lon: number | null }>(
          'SELECT geometry, anchor_lon FROM features WHERE id = ?',
        )
        .get(id);
    expect(JSON.parse(row('m0')?.geometry ?? 'null')).toEqual(square(0, 0, 2));
    expect(row('m0')?.anchor_lon).toBeCloseTo(1, 5);
    // No primary value: empty, with no fallback to the other geometry property.
    expect(row('n0')?.geometry).toBeNull();
    expect(row('n0')?.anchor_lon).toBeNull();
    // The index still covers the non-primary geometry property.
    expect(bboxQuery(db, [49, 49, 51, 51]).map((h) => h.id)).toContain('n0');
  });

  it('a type without a declared primary geometry has an empty geometry column', () => {
    const db = openDb();
    ingest(db, new Model(), [ob('u0', '$type', 'unanchored', 1), ob('u0', 'geometry', point(1, 1), 2)], 10);
    expect(
      db.prepare<{ geometry: string | null }>('SELECT geometry FROM features').get()?.geometry,
    ).toBeNull();
  });

  it('commits a batch in one transaction', () => {
    const db = openDb();
    const model = new Model();
    ingest(db, model, [ob('t0', '$type', 'tree', 1), ob('t1', '$type', 'tree', 2)], 10);
    const good = { ...(model.features.get(fid('t0')) as FoldedFeature), updatedSeq: 9 };
    const bad = {
      ...(model.features.get(fid('t1')) as FoldedFeature),
      updatedSeq: 9,
      properties: { boom: 1n as unknown as null },
    };
    expect(() =>
      createFoldWriter(db).apply({
        configVersion: 1,
        schema: SCHEMA,
        features: [good, bad],
        edges: { put: [], remove: [] },
        seq: 9,
      }),
    ).toThrow();
    expect(createFacts(db, INVERSE).feature(fid('t0'))?.updatedSeq).toBe(1);
  });

  it('removes a deleted feature from the R*Tree and brings it back', () => {
    const db = openDb();
    const model = new Model();
    ingest(db, model, [ob('t0', '$type', 'tree', 1), ob('t0', 'geometry', point(1, 1), 2)], 10);
    const whole: Bbox = [0, 0, 5, 5];
    expect(bboxQuery(db, whole).map((h) => h.id)).toEqual(['t0']);
    ingest(db, model, [ob('t0', '$lifecycle', 'deleted', 3)], 10);
    expect(bboxQuery(db, whole)).toEqual([]);
    ingest(db, model, [ob('t0', '$lifecycle', 'active', 4)], 10);
    expect(bboxQuery(db, whole).map((h) => h.id)).toEqual(['t0']);
  });
});

describe('bboxQuery', () => {
  it('finds features whose bbox intersects, filtered by type', () => {
    const db = openDb();
    ingest(
      db,
      new Model(),
      [
        ob('t0', '$type', 'tree', 1),
        ob('t0', 'geometry', point(1, 1), 2),
        ob('a0', '$type', 'area', 3),
        ob('a0', 'geometry', square(3, 3, 2), 4),
      ],
      10,
    );
    expect(bboxQuery(db, [0, 0, 2, 2]).map((h) => h.id)).toEqual(['t0']);
    expect(bboxQuery(db, [4, 4, 9, 9])).toEqual([{ id: 'a0', type: 'area' }]);
    expect(bboxQuery(db, [0, 0, 9, 9], 'area').map((h) => h.id)).toEqual(['a0']);
    expect(bboxQuery(db, [6, 6, 9, 9])).toEqual([]);
  });
});
