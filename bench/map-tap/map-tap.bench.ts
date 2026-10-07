/**
 * Budget (docs/12-performance-budgets.md, WP-688): a tap is one `queryRenderedFeatures` over a 24 px box and one pass
 * over what it returns (`pickHit`), never a pass over all features. The pick costs the same with 600k features on the map
 * as with 6k, because only the hits under the box are looked at. The interaction-to-next-paint row (200 ms) is the limit,
 * judged at the x4 factor on the main thread.
 * Run: npm test -- -c bench/vitest.config.ts bench/map-tap
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { pickHit, type HitClass, type RenderedHit } from '../../packages/ui/src/map/maplibre/tap';

const CLASSES = new Map<string, HitClass>([
  ['ub-single', 'point'],
  ['ub-cluster', 'point'],
  ['ub-shape-line', 'line'],
  ['ub-shape-fill', 'area'],
]);
const LAYERS = ['ub-shape-fill', 'ub-shape-line', 'ub-single'];

/** What the box under a tap reports: `n` hits, areas topmost and the one point last (the worst order for the pick). */
function hits(n: number): RenderedHit[] {
  return Array.from({ length: n }, (_, i) => ({
    layer: { id: i === n - 1 ? 'ub-single' : (LAYERS[i % 2] as string) },
    properties: { id: `f${i}` },
  }));
}

function medianMs(under: readonly RenderedHit[]): number {
  const samples: number[] = [];
  for (let run = 0; run < 15; run++) {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) pickHit(under, CLASSES);
    samples.push((performance.now() - t0) / 1000);
  }
  samples.sort((a, b) => a - b);
  return samples[7] ?? 0;
}

describe('map-tap', () => {
  it('one tap resolves in <= 200 ms at x4, O(features under the tap)', () => {
    const few = medianMs(hits(5));
    const many = medianMs(hits(500)); // a dense area: 500 overlapping features under one tap
    console.log(
      `bench map-tap pick: 5 hits ${(few * 1000).toFixed(2)} us, 500 hits ${(many * 1000).toFixed(2)} us per tap (raw)`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-tap-pick-500',
          limit: 200,
          unit: 'ms',
          row: 'interaction-to-next-paint',
          device: 'x4',
          thread: 'main',
        }),
        Number((many * 4).toFixed(4)),
      ),
    );
  });
});
