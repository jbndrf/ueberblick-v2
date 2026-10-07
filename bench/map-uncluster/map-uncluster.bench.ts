/**
 * WP-666 (R14): un-clustering must not cost O(all features) per map move. 60k anchors; the cluster worker's capped
 * query (`ClusterIndex.queryCapped`: clustered count at the current zoom, then the singles only when they fit the cap).
 * Budget `map-uncluster-query-p95` (derived from the viewport row, 100 ms), worker side at x4, p95 of 4 views x 40 moves.
 * Run: npm test -- -c bench/vitest.config.ts bench/map-uncluster
 */
import { loadavg } from 'node:os';
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { ClusterIndex } from '../../packages/ui/src/map/cluster/index-core';
import type { ClusterPoint } from '../../packages/ui/src/map/cluster/protocol';

const N = 60_000;
const CAP = 500;
const points = (n: number): ClusterPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    lng: 5 + ((i * 7919) % 10_000) / 1000,
    lat: 47 + ((i * 104729) % 8_000) / 1000,
  }));

function built(n: number): ClusterIndex {
  const index = new ClusterIndex();
  index.apply(points(n), [], []);
  index.query([5, 47, 15, 55], 6); // the build is not a map move
  return index;
}

/** Views a person moves through: the district fits the cap (about 130 in view), region (about 700) and country (about 59k) do not; the street view is nearly empty. */
const VIEWS = [
  { name: 'street', zoom: 14, half: 0.05 },
  { name: 'district', zoom: 11, half: 0.2 },
  { name: 'region', zoom: 9, half: 0.5 },
  { name: 'country', zoom: 6, half: 5 },
] as const;

function moves(
  index: ClusterIndex,
  view: (typeof VIEWS)[number],
): { ms: number[]; inView: number; single: boolean } {
  const ms: number[] = [];
  let last = { inView: 0, single: false };
  for (let i = 0; i < 40; i++) {
    const cx = 9 + (i % 8) * 0.1;
    const cy = 51 + Math.floor(i / 8) * 0.1;
    const t0 = performance.now();
    last = index.queryCapped(
      [cx - view.half, cy - view.half, cx + view.half, cy + view.half],
      view.zoom,
      CAP,
    );
    ms.push(performance.now() - t0);
  }
  return { ms, ...last };
}
const p = (v: number[], q: number): number =>
  [...v].sort((a, b) => a - b)[Math.floor(q * (v.length - 1))] ?? 0;

describe('map-uncluster', () => {
  it('capped query per map move at 60k stays under the viewport budget (6k is printed beside it: the cost does not follow the feature count)', () => {
    const big = built(N);
    const small = built(N / 10);
    const all: number[] = [];
    const lines: string[] = [];
    for (const v of VIEWS) {
      const b = moves(big, v);
      const s = moves(small, v);
      all.push(...b.ms);
      lines.push(
        `${v.name}: 60k p50 ${p(b.ms, 0.5).toFixed(2)} ms p95 ${p(b.ms, 0.95).toFixed(2)} ms (in view ${b.inView}, ${b.single ? 'single' : 'clustered'}); 6k p50 ${p(s.ms, 0.5).toFixed(2)} ms`,
      );
    }
    console.log(
      `bench map-uncluster (cap ${CAP}, load ${(loadavg()[0] ?? 0).toFixed(1)}): ${lines.join(' | ')}`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-uncluster-query-p95',
          limit: 100,
          unit: 'ms',
          derivedFrom: 'bbox-query-p95: one capped viewport query per map move, in the cluster worker',
          device: 'x4',
          thread: 'worker',
        }),
        Number(p(all, 0.95).toFixed(2)),
      ),
    );
  });
});
