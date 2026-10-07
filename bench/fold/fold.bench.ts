/**
 * Budget (docs/12): 60k snapshot <= 20 s overall, so fold of the whole stream must be a small
 * share of it; a 1,000-feature page must stay well under the 100 ms main-thread limit.
 * Incremental: one new observation on a 60k-feature world costs O(observations of that feature).
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { createFold } from '../../packages/core/src/fold';
import type { FoldSchema, FoldedFeature } from '../../packages/core/src/fold';
import { createGeo } from '../../packages/core/src/geo';
import type { FeatureId, Json, Key, RecordedObservation, RunId } from '../../packages/core/src/model';
import { points } from '../geo/data';

const k = (s: string) => s as Key;
const schema: FoldSchema = {
  configVersion: 1,
  types: new Map([
    [
      k('tree'),
      {
        geometryProperties: [k('geometry')],
        references: [{ property: k('plot'), relation: k('on_plot'), to: k('plot') }],
        derived: [],
      },
    ],
  ]),
};
const N = 60_000;
const PAGE = 1_000;
/** Cold-JIT pages run first and are reported apart, not judged (B-010); the browser bench judges cold start. */
const WARMUP = 1;

function observations(i: number, geometry: Json): RecordedObservation[] {
  const featureId = `f${i}` as FeatureId;
  const runId = 'r' as RunId;
  const base = i * 6;
  const rows: [string, Json][] = [
    ['$type', 'tree'],
    ['geometry', geometry],
    ['species', `s${i % 40}`],
    ['height_m', i % 300],
    ['plot', `p${i % 500}`],
    ['height_m', (i % 300) + 1],
  ];
  return rows.map(([property, result], j) => ({ featureId, property, result, seq: base + j + 1, runId }));
}

describe('bench: fold', () => {
  const fold = createFold(createGeo());
  const pts = points(N, 300, 200);

  it('folds a 60k-feature snapshot stream in pages of 1,000, then incrementally', () => {
    // only the 1,000 features the incremental step below reads are kept: retaining all 60k in the timed loop
    // would time the GC of the bench's own heap, not fold
    const wanted = new Set(Array.from({ length: 1000 }, (_, i) => (i * 59) % N));
    const kept = new Map<number, FoldedFeature>();
    let folded = 0;
    const pageTimes: number[] = [];
    const t0 = performance.now();
    for (let p = 0; p < N / PAGE; p++) {
      // the rows of a page arrive decoded; building them is not fold work
      const rows: RecordedObservation[][] = [];
      for (let i = p * PAGE; i < (p + 1) * PAGE; i++) rows.push(observations(i, pts[i] as unknown as Json));
      const t = performance.now();
      for (const [k, r] of rows.entries()) {
        const f = fold.feature(undefined, r, schema).feature;
        if (!f) continue;
        folded++;
        if (wanted.has(p * PAGE + k)) kept.set(p * PAGE + k, f);
      }
      pageTimes.push(performance.now() - t);
    }
    const total = performance.now() - t0;
    const worst = Math.max(...pageTimes.slice(WARMUP));
    console.log(
      `fold 60k: total ${total.toFixed(0)} ms, worst page ${worst.toFixed(1)} ms (warm-up page ${Math.max(...pageTimes.slice(0, WARMUP)).toFixed(1)} ms not judged), mean page ${(total / pageTimes.length).toFixed(1)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'fold-page-worst',
          limit: 100,
          unit: 'ms',
          derivedFrom:
            'long-task: fold of one snapshot page; applyPage runs on the main thread on the device (client README)',
          device: 'x4',
          thread: 'main',
        }),
        Number(worst.toFixed(1)),
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'fold-60k-total',
          limit: 5000,
          unit: 'ms',
          derivedFrom: 'cold-start-60k: fold of all snapshot pages is part of cold start',
          device: 'x4',
          thread: 'main',
        }),
        Math.round(total),
      ),
    );
    expect(folded).toBe(N);

    const t1 = performance.now();
    let seq = N * 6;
    for (let i = 0; i < 1000; i++) {
      const prev = kept.get((i * 59) % N) as FoldedFeature;
      fold.feature(
        prev,
        [{ featureId: prev.id, property: 'height_m', result: i, seq: ++seq, runId: 'r' as RunId }],
        schema,
      );
    }
    const per = (performance.now() - t1) / 1000;
    console.log(`incremental: ${(per * 1000).toFixed(1)} us per observation`);
    assertBudget(
      report(
        defineBudget({
          id: 'fold-incremental-per-obs',
          limit: 1,
          unit: 'ms',
          derivedFrom: 'delta-visible: folding one incoming observation must be far below 1 s',
          device: 'x4',
          thread: 'main',
        }),
        Number(per.toFixed(4)),
      ),
    );
  });
});
