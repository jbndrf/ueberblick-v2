// WP-306: the audit metadata fold derives (createdBy, createdAt, changedAt) is incremental, order-stable and
// identical in every adapter, because they all call this fold (R1). Property tests over random histories.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo } from '../geo';
import type { FeatureId, Instant, Json, Key, RecordedObservation, RunId } from '../model';
import { createFold } from '.';
import type { FoldedFeature, FoldSchema } from './contract';
import { AUDIT_CLOCK_SKEW_MS, AUDIT_MAX_OFFLINE_AGE_MS } from '../registry/limits';
import { auditOf, clampClientTime, creatorOf } from './audit';

const schema: FoldSchema = {
  configVersion: 1,
  types: new Map([['t' as Key, { geometryProperties: [], references: [], derived: [] }]]),
};
const fold = createFold(createGeo());
const ID = 'f1' as FeatureId;

interface Step {
  readonly property: string;
  readonly result: Json;
  readonly time: number | undefined;
}
const iso = (n: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

/** A history: `$type` first, then writes, lifecycle changes and (possibly repeated) creator observations. */
const history = fc.array(
  fc.oneof(
    fc.record({
      property: fc.constantFrom('a', 'b', 'c'),
      result: fc.integer({ min: 0, max: 9 }),
      time: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
    }),
    fc.record({
      property: fc.constant('$lifecycle'),
      result: fc.constantFrom('active', 'completed'),
      time: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
    }),
    fc.record({
      property: fc.constant('$created_by'),
      result: fc.constantFrom('anna', 'bernd'),
      time: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
    }),
  ),
  { maxLength: 25 },
);

function recorded(first: Step, steps: readonly Step[]): RecordedObservation[] {
  return [first, ...steps].map((s, i) => ({
    featureId: ID,
    property: s.property,
    result: s.result,
    seq: i + 1,
    runId: 'r' as RunId,
    ...(s.time === undefined ? {} : { phenomenonTime: iso(s.time) }),
  }));
}

const foldAll = (obs: readonly RecordedObservation[]): FoldedFeature | undefined =>
  fold.feature(undefined, obs, schema).feature;

function foldChunks(obs: readonly RecordedObservation[], cuts: readonly number[]): FoldedFeature | undefined {
  let state: FoldedFeature | undefined;
  let from = 0;
  for (const cut of [...cuts.map((c) => c % (obs.length + 1)).sort((a, b) => a - b), obs.length]) {
    if (cut > from) state = fold.feature(state, obs.slice(from, cut), schema).feature ?? state;
    from = Math.max(from, cut);
  }
  return state;
}

/** The closed form of the contract: the first creator, the `$type` time, the time of the newest timed observation. */
function expected(obs: readonly RecordedObservation[]) {
  const by = obs.find((o) => o.property === '$created_by')?.result;
  const created = obs.find((o) => o.property === '$type')?.phenomenonTime;
  const changed = [...obs].reverse().find((o) => o.phenomenonTime !== undefined)?.phenomenonTime;
  return {
    ...(typeof by === 'string' ? { createdBy: by } : {}),
    ...(created === undefined ? {} : { createdAt: created }),
    ...(changed === undefined ? {} : { changedAt: changed }),
  };
}

const firstStep = fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined });

describe('fold audit metadata (property)', () => {
  it('equals the closed form of the contract', () => {
    fc.assert(
      fc.property(firstStep, history, (t0, steps) => {
        const obs = recorded({ property: '$type', result: 't', time: t0 }, steps);
        expect(auditOf(foldAll(obs) ?? {})).toEqual(expected(obs));
      }),
    );
  });

  it('is the same folded incrementally in any chunking (device sync pages vs one server fold)', () => {
    fc.assert(
      fc.property(firstStep, history, fc.array(fc.nat(30), { maxLength: 6 }), (t0, steps, cuts) => {
        const obs = recorded({ property: '$type', result: 't', time: t0 }, steps);
        const whole = foldAll(obs);
        const parts = foldChunks(obs, cuts);
        expect(auditOf(parts ?? {})).toEqual(auditOf(whole ?? {}));
        expect(parts?.properties).toEqual(whole?.properties);
        expect(whole?.properties).not.toHaveProperty('$created_by');
      }),
    );
  });

  it('createdBy is the first creator observation: a later one never replaces it', () => {
    const obs = recorded({ property: '$type', result: 't', time: 1 }, [
      { property: '$created_by', result: 'anna', time: 2 },
      { property: '$created_by', result: 'bernd', time: 3 },
    ]);
    expect(foldAll(obs)?.createdBy).toBe('anna');
  });

  it('creatorOf is the actor id of the run', () => {
    expect(creatorOf({ actor: { id: 'anna', kind: 'participant', roles: [] } })).toBe('anna');
  });
});

describe('clampClientTime (WP-762)', () => {
  const server = '2026-06-01T10:00:00.000Z' as Instant;
  const at = fc.integer({ min: 0, max: 4_102_444_800_000 }).map((n) => new Date(n).toISOString() as Instant);

  it('always lands in [server - max age, server + skew] and is idempotent', () => {
    fc.assert(
      fc.property(at, (t) => {
        const out = clampClientTime(t, server);
        const ms = Date.parse(out);
        expect(ms).toBeLessThanOrEqual(Date.parse(server) + AUDIT_CLOCK_SKEW_MS);
        expect(ms).toBeGreaterThanOrEqual(Date.parse(server) - AUDIT_MAX_OFFLINE_AGE_MS);
        expect(clampClientTime(out, server)).toBe(out);
      }),
    );
  });

  it('keeps a time inside the window unchanged', () => {
    fc.assert(
      fc.property(fc.integer({ min: -AUDIT_MAX_OFFLINE_AGE_MS, max: AUDIT_CLOCK_SKEW_MS }), (d) => {
        const t = new Date(Date.parse(server) + d).toISOString() as Instant;
        expect(clampClientTime(t, server)).toBe(t);
      }),
    );
  });
});
