/**
 * Budget (docs/12, R14): `Facts.edgesFrom` / `edgesTo` inside a run share the fact-lookup line, p95 < 1 ms at 60k features.
 * They filter live far ends (WP-146), so this bench also guards the query plan (edge index, no scan).
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { createFacts } from '../../packages/server/src/store/facts';
import type { FeatureId, Key } from '../../packages/core/src';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;

describe('bench: server facts edges', () => {
  it('edgesFrom / edgesTo at 60k', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const facts = createFacts(db, new Map());
    const edges = db
      .prepare<{ from_id: string; to_id: string; relation: string }>(
        'SELECT from_id, to_id, relation FROM edges LIMIT 20000',
      )
      .all();
    expect(edges.length).toBeGreaterThan(0);
    const time = (f: (e: (typeof edges)[number]) => number): { p95: number; hits: number } => {
      const times: number[] = [];
      let hits = 0;
      for (let i = 0; i < 5000; i++) {
        const e = edges[(i * 7919) % edges.length] as (typeof edges)[number];
        const t = performance.now();
        hits += f(e);
        times.push(performance.now() - t);
      }
      return { p95: p95(times), hits };
    };
    const from = time((e) => facts.edgesFrom(e.from_id as FeatureId).length);
    const fromRel = time((e) => facts.edgesFrom(e.from_id as FeatureId, e.relation as Key).length);
    const to = time((e) => facts.edgesTo(e.to_id as FeatureId, e.relation as Key).length);
    console.log(
      `server facts edges 60k: edgesFrom p95 ${from.p95.toFixed(3)} ms, edgesFrom(rel) ${fromRel.p95.toFixed(3)} ms, edgesTo(rel) ${to.p95.toFixed(3)} ms`,
    );
    const budget = defineBudget({
      id: 'server-facts-edges-p95',
      limit: 1,
      unit: 'ms',
      derivedFrom: 'run-endpoint-p95: fact lookup inside a run, a small share of the 50 ms',
      device: 'server',
    });
    assertBudget(report(budget, Number(Math.max(from.p95, fromRel.p95, to.p95).toFixed(3))));
    expect(from.hits).toBeGreaterThan(0);
    db.close();
  });
});
