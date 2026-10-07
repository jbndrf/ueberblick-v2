// WP-311: `$version` pins a feature to a config version (A-029). Fold derives `pinnedVersion`: highest seq wins,
// null unpins, absent floats. Property tests: order-independent and chunk-stable (R1: every adapter calls this fold).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo } from '../geo';
import type { FeatureId, Json, Key, RecordedObservation, RunId } from '../model';
import { createFold } from '.';
import type { FoldedFeature, FoldSchema } from './contract';
import { RESERVED_VERSION } from './state';

const schema: FoldSchema = {
  configVersion: 1,
  types: new Map([['t' as Key, { geometryProperties: [], references: [], derived: [] }]]),
};
const fold = createFold(createGeo());
const ID = 'f1' as FeatureId;

const rec = (property: string, result: Json, seq: number): RecordedObservation => ({
  featureId: ID,
  property,
  result,
  seq,
  runId: 'r' as RunId,
});
const foldAll = (obs: readonly RecordedObservation[]): FoldedFeature | undefined =>
  fold.feature(undefined, obs, schema).feature;
const T0 = rec('$type', 't', 1);

const step = fc.oneof(
  fc.record({ property: fc.constant(RESERVED_VERSION), result: fc.integer({ min: 1, max: 9 }) }),
  fc.record({ property: fc.constant(RESERVED_VERSION), result: fc.constant(null) }),
  fc.record({ property: fc.constantFrom('a', 'b'), result: fc.integer({ min: 0, max: 9 }) }),
);
const history = fc.array(step, { maxLength: 25 });
const build = (steps: readonly { property: string; result: Json }[]): RecordedObservation[] => [
  T0,
  ...steps.map((s, i) => rec(s.property, s.result, i + 2)),
];
/** The closed form: the newest `$version` observation; a number pins, null (or none) floats. */
const expectedPin = (obs: readonly RecordedObservation[]): number | undefined => {
  const last = [...obs].reverse().find((o) => o.property === RESERVED_VERSION);
  return typeof last?.result === 'number' ? last.result : undefined;
};

describe('fold $version', () => {
  it('pins, re-pins and unpins; absent floats', () => {
    expect(foldAll([T0])?.pinnedVersion).toBeUndefined();
    expect(foldAll([T0, rec(RESERVED_VERSION, 2, 2)])?.pinnedVersion).toBe(2);
    expect(foldAll([T0, rec(RESERVED_VERSION, 2, 2), rec(RESERVED_VERSION, 5, 3)])?.pinnedVersion).toBe(5);
    const unpinned = foldAll([T0, rec(RESERVED_VERSION, 2, 2), rec(RESERVED_VERSION, null, 3)]);
    expect(unpinned?.pinnedVersion).toBeUndefined();
    expect(unpinned).not.toHaveProperty('pinnedVersion');
  });

  it('is never a property, and a stray value (not a positive integer) is ignored', () => {
    const f = foldAll([T0, rec(RESERVED_VERSION, 3, 2)]);
    expect(f?.properties).not.toHaveProperty(RESERVED_VERSION);
    for (const bad of ['3', 0, -1, 1.5, true, [3]] as Json[])
      expect(foldAll([T0, rec(RESERVED_VERSION, 3, 2), rec(RESERVED_VERSION, bad, 3)])?.pinnedVersion).toBe(
        3,
      );
  });

  it('highest seq wins, whatever order the observations arrive in (property)', () => {
    fc.assert(
      fc.property(history, fc.infiniteStream(fc.nat()), (steps, rnd) => {
        const obs = build(steps);
        const shuffled = [...obs].sort(() => ((rnd.next().value as number) % 3) - 1);
        expect(foldAll(shuffled)?.pinnedVersion).toBe(expectedPin(obs));
        expect(foldAll(obs)?.pinnedVersion).toBe(expectedPin(obs));
      }),
    );
  });

  it('is the same folded incrementally in any chunking (property)', () => {
    fc.assert(
      fc.property(history, fc.array(fc.nat(30), { maxLength: 6 }), (steps, cuts) => {
        const obs = build(steps);
        let state: FoldedFeature | undefined;
        let from = 0;
        for (const cut of [...cuts.map((c) => c % (obs.length + 1)).sort((a, b) => a - b), obs.length]) {
          if (cut > from) state = fold.feature(state, obs.slice(from, cut), schema).feature ?? state;
          from = Math.max(from, cut);
        }
        expect(state?.pinnedVersion).toBe(expectedPin(obs));
        expect(state).toEqual(foldAll(obs));
      }),
    );
  });
});
