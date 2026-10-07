/**
 * Budget (docs/12): viewport/bbox query p95 <= 100 ms at 60k; this WP's own line: one feature + one related
 * lookup p95 < 1 ms. Data: the seeded bench generator (60k features, derived edges).
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, DOC_BUDGETS, defineBudget, report, type Budget } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { createFacts, bboxQuery } from '../../packages/server/src/store/facts';
import type { InverseRelations } from '../../packages/server/src/store';
import type { FeatureId, Key } from '../../packages/core/src';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;

describe('bench: server facts', () => {
  it('feature + related lookup and bbox query at 60k', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const relations = db
      .prepare<{ relation: string; type: string; from: string }>(
        'SELECT DISTINCT e.relation AS relation, t.type AS type, f.type AS "from" FROM edges e JOIN features f ON f.id = e.from_id JOIN features t ON t.id = e.to_id',
      )
      .all();
    // A real inverse for every stored relation, in the store's shape (`<target type>.inv_<relation>` -> where the
    // edges are stored and by which type), so `related` takes the `sources` path.
    const inverse: InverseRelations = new Map(
      relations.map((r) => [`${r.type}.inv_${r.relation}`, { key: r.relation, from: r.from }]),
    );
    const facts = createFacts(db, inverse);
    const ids = db
      .prepare<{ id: string }>('SELECT id FROM features')
      .all()
      .map((r) => r.id as FeatureId);
    const edges = db
      .prepare<{ from_id: string; relation: string }>('SELECT from_id, relation FROM edges LIMIT 20000')
      .all();
    expect(ids.length).toBeGreaterThanOrEqual(60_000);
    expect(edges.length).toBeGreaterThan(0);

    const lookups: number[] = [];
    for (let i = 0; i < 5000; i++) {
      const e = edges[(i * 7919) % edges.length] as { from_id: string; relation: string };
      const id = (i % 2 === 0 ? e.from_id : ids[(i * 104729) % ids.length]) as FeatureId;
      const t = performance.now();
      facts.feature(id);
      facts.related(id, e.relation as Key);
      lookups.push(performance.now() - t);
    }
    const lookup = p95(lookups);

    // The `sources` path: an inverse read on the target side of the first relation.
    const target = relations[0] as { relation: string; type: string; from: string };
    const inverseName = `inv_${target.relation}` as Key;
    const tos = db
      .prepare<{ to_id: string }>(
        `SELECT DISTINCT e.to_id FROM edges e JOIN features t ON t.id = e.to_id
         WHERE e.relation = ? AND t.type = ? LIMIT 5000`,
      )
      .all(target.relation, target.type);
    const inverseTimes: number[] = [];
    let inverseHits = 0;
    for (let i = 0; i < 5000; i++) {
      const id = (tos[i % tos.length] as { to_id: string }).to_id as FeatureId;
      const t = performance.now();
      inverseHits += facts.related(id, inverseName).length;
      inverseTimes.push(performance.now() - t);
    }
    const inverseP95 = p95(inverseTimes);
    expect(inverseHits).toBeGreaterThan(0);

    const b = db
      .prepare<{ w: number; s: number; e: number; n: number }>(
        'SELECT min(minx) AS w, min(miny) AS s, max(maxx) AS e, max(maxy) AS n FROM feature_bbox',
      )
      .get() as { w: number; s: number; e: number; n: number };
    const queries: number[] = [];
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const fx = ((i * 37) % 90) / 100;
      const fy = ((i * 53) % 90) / 100;
      const box = [
        b.w + (b.e - b.w) * fx,
        b.s + (b.n - b.s) * fy,
        b.w + (b.e - b.w) * (fx + 0.1),
        b.s + (b.n - b.s) * (fy + 0.1),
      ] as const;
      const t = performance.now();
      hits += bboxQuery(db, box).length;
      queries.push(performance.now() - t);
    }
    const bbox = p95(queries);
    // near(type, bbox): one type, a small box around real features, <= 50 hits.
    const types = db.prepare<{ type: string }>('SELECT DISTINCT type FROM features').all();
    const pts = db
      .prepare<{ type: string; minx: number; miny: number }>(
        'SELECT f.type AS type, r.minx AS minx, r.miny AS miny FROM feature_bbox r JOIN features f ON f.rowid = r.rid LIMIT 3000',
      )
      .all();
    const nearTimes: number[] = [];
    let nearHits = 0;
    let nearMax = 0;
    for (const q of pts) {
      const t = performance.now();
      const n = [...facts.near(q.type as Key, [q.minx - 1e-4, q.miny - 1e-4, q.minx + 1e-4, q.miny + 1e-4])]
        .length;
      nearTimes.push(performance.now() - t);
      nearHits += n;
      nearMax = Math.max(nearMax, n);
    }
    const nearP95 = p95(nearTimes);
    console.log(
      `server facts near (${types.length} types, mean ${(nearHits / pts.length).toFixed(1)}, max ${nearMax} hits) p95 ${nearP95.toFixed(3)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'server-facts-near-p95',
          limit: 2,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: near lookup inside a run, a small share of the 50 ms',
          device: 'server',
        }),
        Number(nearP95.toFixed(3)),
      ),
    );
    console.log(
      `server facts 60k: feature+related p95 ${lookup.toFixed(3)} ms, bbox (10% x 10% viewport, mean ${Math.round(hits / 300)} hits) p95 ${bbox.toFixed(1)} ms, inverse (${target.relation}, mean ${(inverseHits / 5000).toFixed(1)} sources) p95 ${inverseP95.toFixed(3)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'server-facts-lookup-p95',
          limit: 1,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: fact lookup inside a run, a small share of the 50 ms',
          device: 'server',
        }),
        Number(lookup.toFixed(3)),
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'server-facts-inverse-p95',
          limit: 1,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: fact lookup inside a run, a small share of the 50 ms',
          device: 'server',
        }),
        Number(inverseP95.toFixed(3)),
      ),
    );
    assertBudget(report(DOC_BUDGETS['bbox-query-p95'] as Budget, Number(bbox.toFixed(1))));
    db.close();
  });
});
