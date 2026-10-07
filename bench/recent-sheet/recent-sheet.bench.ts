/**
 * Budget (docs/12): interaction to next paint <= 200 ms. Opening Zuletzt walks the features of every type once and
 * keeps the newest 50 (WP-622); at 60k features it must take a small part of that. Seeded, deterministic.
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import type { FeatureId, FeatureState, Key } from '../../packages/core/src/model';
import { newest } from '../../apps/web/src/lib/participant/sheets/recent/recent';

const N = 60_000;
const states: FeatureState[] = Array.from({ length: N }, (_, i) => ({
  id: `f${i}` as FeatureId,
  type: 'tree' as Key,
  properties: { name: `t${i}` },
  lifecycle: 'active' as const,
  updatedSeq: (i * 7919) % N,
}));

describe('Zuletzt over 60k features', () => {
  it('selects the newest 50 well inside the interaction budget', () => {
    const runs: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t = performance.now();
      newest(states, 50);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    assertBudget(
      report(
        defineBudget({
          id: 'recent-sheet-60k',
          limit: 50,
          unit: 'ms',
          derivedFrom: 'interaction-to-next-paint: a quarter of the 200 ms for the selection',
          device: 'x4',
          thread: 'main',
        }),
        runs[3] as number,
      ),
    );
  });
});
