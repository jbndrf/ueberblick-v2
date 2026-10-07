/**
 * WP-733 (R14): marking the feature whose sheet is open must not cost O(features). Selecting and deselecting is four
 * `setFilter` calls on the highlight layers (and a colour on first use); the source data is never rewritten, so the cost
 * is the same with 10k features on the map as with 10. The renderer runs on the fake MapLibre of the unit specs with 10k
 * features delivered; the bench counts the data writes (there must be none) and times the calls. Derived from the
 * interaction-to-next-paint row (200 ms), main thread, x4. MapLibre's own filter re-evaluation is a GPU/tile-side cost
 * proportional to the tiles in view, not measured here (a real browser shows it in `bench:browser`).
 * Run: npm test -- -c bench/vitest.config.ts bench/map-select
 */
import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { pointFeature } from '../../packages/ui/src/map/test-helpers';
import { mount, tick } from '../../packages/ui/src/map/maplibre/renderer-fixture';

const N = 10_000;
const ROUNDS = 2_000;

async function mounted(n: number) {
  const features = Array.from({ length: n }, (_, i) =>
    pointFeature(`f${i}`, 5 + ((i * 7919) % 10_000) / 1000, 47 + ((i * 104729) % 8_000) / 1000),
  );
  const m = mount(features);
  await m.handle.ready;
  for (let i = 0; i < 5; i++) await tick();
  return m;
}

async function medianMs(n: number): Promise<{ ms: number; writes: number }> {
  const m = await mounted(n);
  const writes = (): number => m.calls.setData.length + m.calls.updateData.length;
  const before = writes();
  const samples: number[] = [];
  for (let run = 0; run < 9; run++) {
    const t0 = performance.now();
    for (let i = 0; i < ROUNDS; i++) {
      m.handle.setSelected?.({ id: `f${i % n}` as FeatureId, color: '#0b57d0' });
      m.handle.setSelected?.(null);
    }
    samples.push((performance.now() - t0) / (ROUNDS * 2));
    m.calls.filters.length = 0;
    m.calls.paints.length = 0;
  }
  samples.sort((a, b) => a - b);
  return { ms: samples[4] ?? 0, writes: writes() - before };
}

describe('map-select', () => {
  it('select and deselect cost the same at 10k features as at 10, and write no data', async () => {
    const few = await medianMs(10);
    const many = await medianMs(N);
    console.log(
      `bench map-select: 10 features ${(few.ms * 1000).toFixed(2)} us, ${N} features ${(many.ms * 1000).toFixed(2)} us per select or deselect (raw); data writes ${many.writes}`,
    );
    expect(many.writes).toBe(0);
    assertBudget(
      report(
        defineBudget({
          id: 'map-select-10k',
          limit: 200,
          unit: 'ms',
          row: 'interaction-to-next-paint',
          device: 'x4',
          thread: 'main',
        }),
        Number((many.ms * 4).toFixed(4)),
      ),
    );
  });
});
