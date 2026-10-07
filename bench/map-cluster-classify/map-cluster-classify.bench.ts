/**
 * Budget (docs/12-performance-budgets.md, WP-674, B-018): the cluster build with the classifying property on (per-value
 * counts through Supercluster `map` and `reduce`) at 60k points and 6 values must stay within the warmed build budget
 * (1200 ms at x4 = 300 ms raw), and the cost over the plain build is reported. A query after the build reads the counts
 * of the clusters in view only (O(clusters in view)).
 * Run: npm test -- -c bench/vitest.config.ts bench/map-cluster-classify
 */
import { loadavg } from 'node:os';
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { ClusterIndex } from '../../packages/ui/src/map/cluster/index-core';
import { warmUp } from '../../packages/ui/src/map/cluster/warm';

const N = 60_000;
const VALUES = ['erfasst', 'kontrolliert', 'massnahme', 'erledigt', 'archiviert', 'geplant'] as const;
const points = Array.from({ length: N }, (_, i) => ({
  id: `f${i}`,
  lng: 5 + ((i * 7919) % 10_000) / 1000,
  lat: 47 + ((i * 104729) % 8_000) / 1000,
  props: { stage: VALUES[(i * 31) % VALUES.length] as string },
}));

/** One cold index: apply, then the first query, which builds (the worker's first-markers path). */
function build(by: string | undefined): { ms: number; items: number; queryMs: number } {
  const index = new ClusterIndex();
  index.setKeys(['stage'], []);
  index.setClassify(by);
  const t0 = performance.now();
  index.apply(points, [], []);
  const items = index.query([5, 47, 15, 55], 6);
  const ms = performance.now() - t0;
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) index.query([5, 47, 15, 55], 6 + (i % 3));
  return { ms, items: items.length, queryMs: (performance.now() - t1) / 20 };
}
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

describe('map-cluster-classify', () => {
  it('build of 60k anchors with per-value counts <= 1200 ms at x4', () => {
    warmUp(); // as the real worker does while it waits for the first delivery
    const plain: number[] = [];
    const counted: number[] = [];
    let items = 0;
    let queryMs = 0;
    for (let i = 0; i < 5; i++) {
      plain.push(build(undefined).ms);
      const c = build('stage');
      counted.push(c.ms);
      items = c.items;
      queryMs = c.queryMs;
    }
    console.log(
      `bench map-cluster-classify 60k, ${VALUES.length} values: plain build median ${median(plain).toFixed(0)} ms, with counts ${median(counted).toFixed(0)} ms (+${(median(counted) - median(plain)).toFixed(0)} ms), ${items} items, query ${queryMs.toFixed(2)} ms; load ${(loadavg()[0] ?? 0).toFixed(1)}`,
    );
    // The plain build on the same machine and run, so the cost of the counts is read as a difference (not asserted).
    report(
      defineBudget({
        id: 'map-cluster-classify-plain-build-60k',
        limit: 1200,
        unit: 'ms',
        derivedFrom: 'cold-start-60k: the cluster build without counts, for comparison',
        device: 'x4',
        thread: 'worker',
      }),
      Math.round(median(plain)),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-cluster-classify-build-60k',
          limit: 1200,
          unit: 'ms',
          derivedFrom: 'cold-start-60k: the cluster build with the classifying property, the warmed build budget of map-cluster',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round(median(counted)),
      ),
    );
  });
});
