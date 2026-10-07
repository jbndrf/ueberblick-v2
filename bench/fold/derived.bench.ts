/**
 * Budget (WP-043): recomputing the derived relations of ONE moved feature among 60k, with 2,000
 * bbox candidates and a full condition, <= 20 ms. The lookup is an in-memory stand-in for the
 * R*Tree: it returns the 2,000 candidates without scanning the 60k (the adapter's job), and its
 * `condition` is a property comparison (the compiled expression's cost is the adapter's, WP-104).
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { createFold } from '../../packages/core/src/fold';
import type { DerivedLookup, FoldSchema, FoldedFeature } from '../../packages/core/src/fold';
import { createGeo } from '../../packages/core/src/geo';
import type { Polygon } from '../../packages/core/src/geo';
import type { FeatureId, Json, Key, RecordedObservation, RunId } from '../../packages/core/src/model';

const k = (s: string) => s as Key;
const schema: FoldSchema = {
  configVersion: 1,
  types: new Map([
    [
      k('event'),
      {
        geometryProperties: [k('area')],
        references: [],
        derived: [
          {
            relation: k('clash'),
            to: k('event'),
            predicate: 'intersects',
            selfProperty: k('area'),
            otherProperty: k('area'),
            condition: 'types.event.relations.clash.derive',
          },
        ],
        derivedInputs: [k('day')],
      },
    ],
  ]),
};
const sq = (x: number, y: number, s: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
      [x, y],
    ],
  ],
});

describe('bench: fold derived condition', () => {
  const fold = createFold(createGeo());
  const make = (i: number, day: number, g: Polygon): FoldedFeature => {
    const id = `e${i}` as FeatureId;
    const runId = 'r' as RunId;
    const obs: RecordedObservation[] = [
      { featureId: id, property: '$type', result: 'event', seq: 1, runId },
      { featureId: id, property: 'day', result: day, seq: 2, runId },
      { featureId: id, property: 'area', result: g as unknown as Json, seq: 3, runId },
    ];
    return fold.feature(undefined, obs, schema).feature as FoldedFeature;
  };

  it('recomputes one moved feature with 2,000 candidates among 60k in <= 20 ms', () => {
    const N = 60_000;
    const CANDIDATES = 2_000;
    // 60k features exist; the R*Tree answers with the 2,000 whose bbox overlaps the query.
    const candidates = Array.from({ length: CANDIDATES }, (_, i) =>
      make(i, i % 2, sq(i % 40, (i % 50) / 10, 3)),
    );
    const moved = make(N, 0, sq(10, 1, 3));
    const lookup: DerivedLookup = {
      near: () => candidates,
      typesDerivingTo: () => [k('event')],
      edgesFrom: () => [],
      edgesTo: () => [],
      condition: (_p, s, o) => s.id !== o.id && s.properties['day'] === o.properties['day'],
    };
    fold.recomputeDerived(moved, lookup, schema); // warm-up
    const runs: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      const c = fold.recomputeDerived(moved, lookup, schema);
      runs.push(performance.now() - t);
      expect(c.put.length).toBeGreaterThan(0);
    }
    runs.sort((a, b) => a - b);
    const median = runs[Math.floor(runs.length / 2)] as number;
    console.log(`recomputeDerived, 2k candidates, condition: median ${median.toFixed(1)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'fold-derived-condition-2k',
          limit: 20,
          unit: 'ms',
          derivedFrom: 'delta-visible: recompute of the derived relations of one moved feature',
          device: 'x4',
          thread: 'main',
        }),
        Number(median.toFixed(1)),
      ),
    );
  });
});
