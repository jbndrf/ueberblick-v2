import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFold } from '../../fold';
import type { FoldSchema } from '../../fold/contract';
import { createGeo } from '../../geo';
import type { FeatureId, Json, Key, RecordedObservation, RunId } from '../../model';
import { parseRedactionKey } from '../../sync';
import { planRedaction, type RedactPair } from './index';

const fid = fc.uuid().map((s) => s as FeatureId);
const pair = fc.record({ featureId: fid, property: fc.constantFrom('phone', 'name', 'photo', 'note') });
const pairs = fc.array(pair, { maxLength: 30 });

describe('planRedaction', () => {
  it('appends one null observation per distinct pair and purges exactly those pairs', () => {
    fc.assert(
      fc.property(pairs, (input) => {
        const plan = planRedaction({ pairs: input });
        const keys = new Set(input.map((p) => `${p.featureId}|${p.property}`));
        expect(plan.observations).toHaveLength(keys.size);
        expect(plan.observations.every((o) => o.result === null)).toBe(true);
        expect(new Set(plan.purge.map((p) => `${p.featureId}|${p.property}`))).toEqual(keys);
        expect(plan.purge).toHaveLength(keys.size);
        expect(plan.observations.map((o) => [o.featureId, o.property])).toEqual(
          plan.purge.map((p) => [p.featureId, p.property]),
        );
      }),
    );
  });

  it('is deterministic and independent of input order and repeats', () => {
    fc.assert(
      fc.property(pairs, (input) => {
        const a = planRedaction({ pairs: input });
        const b = planRedaction({ pairs: [...input].reverse().concat(input) });
        expect(b).toEqual(a);
      }),
    );
  });

  it('names one redaction tombstone id per pair (core redactionKey)', () => {
    fc.assert(
      fc.property(pairs, (input) => {
        const plan = planRedaction({ pairs: input });
        const parsed = plan.tombstones.map(parseRedactionKey);
        expect(parsed).toEqual(plan.purge.map((p) => ({ featureId: p.featureId, property: p.property })));
      }),
    );
  });

  it('never touches reserved keys or other properties: refuses $type and $lifecycle', () => {
    const bad: RedactPair[] = [{ featureId: 'f' as FeatureId, property: '$type' }];
    expect(() => planRedaction({ pairs: bad })).toThrowError(/reserved/);
  });

  it('carries the phenomenon time when given', () => {
    const plan = planRedaction({
      pairs: [{ featureId: 'f' as FeatureId, property: 'phone' }],
      phenomenonTime: '2026-01-01T00:00:00Z',
    });
    expect(plan.observations[0]?.phenomenonTime).toBe('2026-01-01T00:00:00Z');
  });

  it('leaves fold unchanged: the current value is the appended null, other properties stay', () => {
    const schema: FoldSchema = {
      configVersion: 1,
      types: new Map([['tree' as Key, { geometryProperties: [], references: [], derived: [] }]]),
    };
    const fold = createFold(createGeo());
    const ob = (property: string, result: Json, seq: number): RecordedObservation => ({
      featureId: 'f1' as FeatureId,
      property,
      result,
      seq,
      runId: 'r' as RunId,
    });
    const before = [
      ob('$type', 'tree', 1),
      ob('phone', '123', 2),
      ob('phone', '456', 3),
      ob('species', 'oak', 4),
    ];
    const plan = planRedaction({ pairs: [{ featureId: 'f1' as FeatureId, property: 'phone' }] });
    const appended = plan.observations.map((o, i) => ({ ...o, seq: 5 + i, runId: 'e' as RunId }));
    const folded = fold.feature(undefined, [...before, ...appended], schema).feature;
    expect(folded?.properties.phone ?? null).toBeNull();
    expect(folded?.properties.species).toBe('oak');
    const oracle = fold.feature(
      undefined,
      [before[0] as RecordedObservation, before[3] as RecordedObservation],
      schema,
    ).feature;
    expect(folded?.properties.species).toBe(oracle?.properties.species);
  });
});
