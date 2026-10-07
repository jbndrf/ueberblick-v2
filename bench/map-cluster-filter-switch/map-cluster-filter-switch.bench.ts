/**
 * Budget (docs/12-performance-budgets.md, WP-706): a filter switch that hides one of two types removes half of 60k
 * built points; the removal drops the built index and the next query rebuilds it in the worker, so the next answer is
 * exact. Judged against the warmed build budget (1200 ms at x4 = 300 ms raw); the filter-change row (100 ms) is
 * the main-thread cost (one diff), reported apart.
 * Run: npm test -- -c bench/vitest.config.ts bench/map-cluster-filter-switch
 */
import { loadavg } from 'node:os';
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { ClusterIndex } from '../../packages/ui/src/map/cluster/index-core';
import { warmUp } from '../../packages/ui/src/map/cluster/warm';

const N = 60_000;
const points = Array.from({ length: N }, (_, i) => ({
  id: `f${i}`,
  lng: 5 + ((i * 7919) % 10_000) / 1000,
  lat: 47 + ((i * 104729) % 8_000) / 1000,
}));
const hidden = points.filter((_, i) => i % 2 === 1).map((p) => p.id);
const VIEW = [5, 47, 15, 55] as const;
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

describe('map-cluster-filter-switch', () => {
  it('hiding one of two types at 60k, then the next exact query <= 1200 ms at x4', () => {
    warmUp();
    const applyMs: number[] = [];
    const nextMs: number[] = [];
    for (let run = 0; run < 5; run++) {
      const index = new ClusterIndex();
      index.apply(points, [], []);
      index.query(VIEW, 6); // the built index the user sees
      const t0 = performance.now();
      index.apply([], [], hidden);
      const t1 = performance.now();
      const items = index.query(VIEW, 6);
      const t2 = performance.now();
      expect(items.reduce((n, i) => n + (i.count ?? 1), 0)).toBe(N - hidden.length);
      applyMs.push(t1 - t0);
      nextMs.push(t2 - t0);
    }
    console.log(
      `bench map-cluster-filter-switch 60k, hide half: apply median ${median(applyMs).toFixed(2)} ms, apply + next exact query median ${median(nextMs).toFixed(0)} ms of ${nextMs.map((m) => m.toFixed(0)).join('/')}; load ${(loadavg()[0] ?? 0).toFixed(1)}`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-cluster-filter-switch-60k',
          limit: 1200,
          unit: 'ms',
          derivedFrom: 'cold-start-60k: the lazy rebuild after a removal is the warmed build budget of map-cluster',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round(median(nextMs)),
      ),
    );
  });
});
