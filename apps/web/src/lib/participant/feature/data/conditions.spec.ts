// WP-659: `display.condition` is a CEL rule over `self` and `actor`, evaluated per feature (R5).
import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { EvalContext } from '@ueberblick/core/expr';
import type { FeatureId, Instant, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { conditionFalse } from './conditions';

const config = goldenConfig('templates/baumkataster/2.0.0.yaml');
const ctxWith = (properties: Record<string, unknown>): EvalContext => ({
  vars: new Map<string, never>([['self', { $feature: 't1' } as never]]),
  features: {
    property: (_id: FeatureId, key: string) => properties[key] as never,
    related: () => [],
    history: () => [],
    type: () => 'baum' as Key,
  },
  now: '2026-10-01T10:00:00.000Z' as Instant,
  relations: config.relations,
  geo: createGeo(),
});
const keys = ['vitalitaet', 'befund', 'foto'] as Key[];

describe('conditionFalse (golden: befund shows only once a vitality is set)', () => {
  it('the condition holds: nothing is hidden', () => {
    expect([...conditionFalse(config, 'baum' as Key, keys, ctxWith({ vitalitaet: 'v2' }))]).toEqual([]);
  });
  it('the condition fails: the property is reported', () => {
    expect([...conditionFalse(config, 'baum' as Key, keys, ctxWith({}))]).toEqual(['befund']);
  });
  it('a property without a condition is never reported', () => {
    expect(conditionFalse(config, 'baum' as Key, ['foto' as Key], ctxWith({})).size).toBe(0);
  });
});
