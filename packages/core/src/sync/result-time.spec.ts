// WP-794: `resultTime` is an additive observation column: it round-trips, and a peer that omits it reads as null.
import { describe, expect, it } from 'vitest';
import type { FeatureId, Instant, RunId } from '../model';
import { decodePage, encodePage } from './codec';
import type { SyncPage } from './contract';

const T = '2026-03-05T14:30:00.000Z' as Instant;
const page = (resultTime: Instant | null): SyncPage => ({
  header: {
    kind: 'delta',
    cursor: 1,
    head: 1,
    more: false,
    scopeFingerprint: 'x',
    versions: { deployed: 1, live: [1] },
  },
  features: [],
  edges: [],
  observations: [
    {
      featureId: 'f' as FeatureId,
      property: 'p',
      result: 1,
      phenomenonTime: null,
      resultTime,
      seq: 1,
      runId: 'r' as RunId,
    },
  ],
  tombstones: [],
  runs: [],
  people: [],
});

describe('observation resultTime on the wire', () => {
  it('round-trips a time and a null', () => {
    for (const t of [T, null])
      expect(decodePage(JSON.parse(JSON.stringify(encodePage(page(t)))))).toEqual(page(t));
  });

  it('a page without the column (an older peer) reads as null', () => {
    const wire = JSON.parse(JSON.stringify(encodePage(page(T)))) as {
      observations: { columns: string[]; rows: unknown[][] };
    };
    const at = wire.observations.columns.indexOf('resultTime');
    expect(at).toBeGreaterThan(-1);
    wire.observations.columns.splice(at, 1);
    for (const r of wire.observations.rows) r.splice(at, 1);
    expect(decodePage(wire).observations[0]?.resultTime).toBeNull();
  });
});
