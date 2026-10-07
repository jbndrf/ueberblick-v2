// WP-794 (owner M8 = b): "Erstellt" and "Zuletzt geändert" are the server receive time (O&M resultTime), as in v3.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo } from '../geo';
import type { Actor, FeatureId, Instant, Key, RecordedObservation, RunId } from '../model';
import { createFold } from '.';
import type { FoldSchema } from './contract';
import { resultTimeOf } from './audit';

const schema: FoldSchema = {
  configVersion: 1,
  types: new Map([['t' as Key, { geometryProperties: [], references: [], derived: [] }]]),
};
const fold = createFold(createGeo());
const ID = 'f1' as FeatureId;
const MONDAY = '2026-03-02T09:00:00.000Z' as Instant;
const THURSDAY = '2026-03-05T14:30:00.000Z' as Instant;

const obs = (
  seq: number,
  property: string,
  result: RecordedObservation['result'],
  times: { phenomenonTime?: Instant; resultTime?: Instant },
): RecordedObservation => ({ featureId: ID, property, result, seq, runId: 'r' as RunId, ...times });

describe('audit times follow the resultTime', () => {
  it('Monday work, Thursday sync: the entry shows Thursday', () => {
    const state = fold.feature(
      undefined,
      [
        obs(1, '$type', 't', { phenomenonTime: MONDAY, resultTime: THURSDAY }),
        obs(2, 'a', 1, { phenomenonTime: MONDAY, resultTime: THURSDAY }),
      ],
      schema,
    ).feature;
    expect(state?.createdAt).toBe(THURSDAY);
    expect(state?.changedAt).toBe(THURSDAY);
    expect(state?.properties).toEqual({ a: 1 });
  });

  it('a not yet synced prediction (no resultTime) shows its device time, as v3 did before sync', () => {
    const state = fold.feature(
      undefined,
      [obs(1, '$type', 't', { phenomenonTime: MONDAY }), obs(2, 'a', 1, { phenomenonTime: MONDAY })],
      schema,
    ).feature;
    expect(state?.createdAt).toBe(MONDAY);
    expect(state?.changedAt).toBe(MONDAY);
  });

  it('property: created is the resultTime of the first $type, changed the one of the newest observation', () => {
    const t = fc
      .integer({ min: 0, max: 10_000 })
      .map((n) => new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString() as Instant);
    fc.assert(
      fc.property(fc.array(fc.tuple(t, t), { minLength: 1, maxLength: 15 }), (times) => {
        const list = times.map(([p, r], i) =>
          obs(i + 1, i === 0 ? '$type' : 'a', i === 0 ? 't' : i, { phenomenonTime: p, resultTime: r }),
        );
        const state = fold.feature(undefined, list, schema).feature;
        expect(state?.createdAt).toBe(times[0]?.[1]);
        expect(state?.changedAt).toBe(times[times.length - 1]?.[1]);
        // incremental equals whole
        const half = Math.ceil(list.length / 2);
        const first = fold.feature(undefined, list.slice(0, half), schema).feature;
        expect(fold.feature(first, list.slice(half), schema).feature).toEqual(state);
      }),
    );
  });
});

describe('resultTimeOf: the one stamp of the intake', () => {
  const actor = (kind: Actor['kind']): Actor => ({ id: 'x', kind, roles: [] });
  it('is the receive time for participant, admin and system runs, whatever client time they carry', () => {
    for (const kind of ['participant', 'admin', 'system'] as const)
      expect(resultTimeOf({ actor: actor(kind), clientTime: MONDAY }, THURSDAY)).toBe(THURSDAY);
  });
  it('is the historical client time for an import (v3 migration keeps its times)', () => {
    expect(resultTimeOf({ actor: actor('import'), clientTime: MONDAY }, THURSDAY)).toBe(MONDAY);
    expect(resultTimeOf({ actor: actor('import') }, THURSDAY)).toBe(THURSDAY);
  });
});
