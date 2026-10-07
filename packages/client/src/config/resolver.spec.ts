import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { NEW_FEATURE } from '@ueberblick/core/plan';
import { goldenConfig } from '@ueberblick/core/testing';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import type { ConfigVersionResult } from './contract';
import { AwaitingConfig, createFeatureConfigs } from './resolver';

const v1 = goldenConfig('templates/baumkataster/1.0.0.yaml');
const v2 = goldenConfig('templates/baumkataster/1.1.0.yaml');
const feature = (id: string, version?: number): FeatureState => ({
  id: id as FeatureId,
  type: 'baum' as Key,
  properties: {},
  lifecycle: 'active',
  updatedSeq: 1,
  ...(version === undefined ? {} : { version }),
});

const setup = (
  features: FeatureState[],
  held: Record<number, ConfigVersionResult>,
  deployed: number | undefined,
  fallback = 1,
) =>
  createFeatureConfigs({
    versions: { deployed, get: (v) => held[v] ?? 'refetching' },
    facts: { feature: (id) => features.find((f) => f.id === id) },
    fallback,
  });

describe('feature configs (one resolver for the planner and the reader)', () => {
  const features = [feature('a', 1), feature('b', 2), feature('c')];

  it('a pinned feature resolves to its own version, a floating one and a create to the deployed one', () => {
    const r = setup(features, { 1: v1, 2: v2 }, 2);
    expect(r.of('a' as FeatureId)?.config).toBe(v1);
    expect(r.of('b' as FeatureId)?.config).toBe(v2);
    expect(r.of('c' as FeatureId)?.config).toBe(v2);
    expect(r.of(NEW_FEATURE)?.version).toBe(2);
    expect(r.of('a' as FeatureId)?.version).toBe(1);
  });

  it('before the first header the fallback (the bootstrap or run version) stands in for the deployed one', () => {
    const r = setup(features, { 1: v1 }, undefined, 1);
    expect(r.of('c' as FeatureId)?.version).toBe(1);
    expect(r.deployed).toBe(1);
  });

  it('a version not on the device is undefined from `of` and throws AwaitingConfig from `configFor`', () => {
    const r = setup(features, { 1: v1 }, 1);
    expect(r.of('b' as FeatureId)).toBeUndefined();
    expect(() => r.configFor('b' as FeatureId)).toThrow(AwaitingConfig);
    expect(r.configFor('a' as FeatureId).version).toBe(1);
  });

  it('property: every feature gets the config of its version, one map lookup per open', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.constantFrom(1, 2), { nil: undefined }), { maxLength: 20 }),
        (pins) => {
          let gets = 0;
          const fs = pins.map((p, i) => feature(`f${i}`, p));
          const r = createFeatureConfigs({
            versions: { deployed: 2, get: (v) => (gets++, v === 1 ? v1 : v2) },
            facts: { feature: (id) => fs.find((f) => f.id === id) },
            fallback: 2,
          });
          for (const f of fs) {
            gets = 0;
            expect(r.of(f.id)?.config).toBe((f.version ?? 2) === 1 ? v1 : v2);
            expect(gets).toBe(1);
          }
        },
      ),
    );
  });
});
