/**
 * Budget (docs/12-performance-budgets.md, WP-653): a tap on a cluster asks the worker for the cluster's members
 * (`ClusterIndex.leaves`). It is O(members), never O(all features): the same cluster costs the same in 60k and in 6k
 * points. The tap-to-sheet path must fit the interaction-to-next-paint row (200 ms); the worker's share is judged at
 * the x4 factor against the long-task row (100 ms), as `map-cluster` does for its worker slices.
 * Run: npm test -- -c bench/vitest.config.ts bench/map-cluster-detail
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { ClusterIndex } from '../../packages/ui/src/map/cluster/index-core';

const WORLD = [-180, -90, 180, 90] as const;

function build(n: number): ClusterIndex {
  const index = new ClusterIndex();
  index.apply(
    Array.from({ length: n }, (_, i) => ({
      id: `f${i}`,
      lng: 5 + ((i * 7919) % 10_000) / 1000,
      lat: 47 + ((i * 104729) % 8_000) / 1000,
    })),
    [],
    [],
  );
  return index;
}

/** The members of the biggest cluster at zoom 5 (a country-sized view), median of 9 reads. */
function leavesMedian(index: ClusterIndex): { ms: number; members: number } {
  const clusters = index.query(WORLD, 5).filter((i) => i.clusterId !== undefined);
  const biggest = clusters.reduce((a, b) => ((b.count ?? 0) > (a.count ?? 0) ? b : a));
  const samples: number[] = [];
  let members = 0;
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    members = index.leaves(biggest.clusterId ?? -1).length;
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { ms: samples[4] ?? 0, members };
}

describe('map-cluster-detail', () => {
  it('members of one cluster: <= 100 ms at x4, (O(members); see the per-member line)', () => {
    const big = leavesMedian(build(60_000));
    const small = leavesMedian(build(6_000));
    console.log(
      `bench map-cluster-detail leaves: 60k points, biggest cluster ${big.members} members ${big.ms.toFixed(2)} ms; 6k points, cluster of ${small.members} members ${small.ms.toFixed(2)} ms`,
    );
    // Per member the cost is the same order at 6k and at 60k: reported, not asserted (a walk over all points would grow it
    // with N). The budget below judges the absolute time.
    console.log(
      `bench map-cluster-detail per member: 60k ${((big.ms / big.members) * 1000).toFixed(2)} us, 6k ${((small.ms / small.members) * 1000).toFixed(2)} us`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-cluster-leaves-60k',
          limit: 100,
          unit: 'ms',
          row: 'long-task',
          device: 'x4',
          thread: 'worker',
        }),
        Number(big.ms.toFixed(2)),
      ),
    );
  });
});
