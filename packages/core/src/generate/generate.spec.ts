// WP-342: the generator is pure (seeded rng), centred, covers every property type and spreads stages.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PROPERTY_TYPES } from '../registry';
import type { FeatureType } from '../schema';
import type { Property } from '../schema/property';
import { generateProperties, seededRng, spreadStage, type GenerateContext } from './index';

const ctx = (over: Partial<GenerateContext> = {}): GenerateContext => ({
  n: 0,
  featureOf: () => undefined,
  participant: 'p',
  center: [10, 51],
  rng: seededRng(1),
  ...over,
});

describe('seededRng', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = seededRng(seed);
        const b = seededRng(seed);
        for (let i = 0; i < 20; i++) {
          const x = a();
          expect(x).toBe(b());
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(1);
        }
      }),
    );
  });
});

describe('generateProperties', () => {
  it('has a generator for every property type of the registry', () => {
    const typeKeys = PROPERTY_TYPES.keys;
    const properties = Object.fromEntries(
      typeKeys.map((k) => [`p_${k}`, { type: k, options: { a: 'A' }, to: 'x' } as unknown as Property]),
    );
    expect(() => generateProperties(properties, ctx())).not.toThrow();
  });

  it('puts every geometry within about 1 km of the centre', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 40 }), (seed, n) => {
        const rng = seededRng(seed);
        for (const kind of ['point', 'line', 'polygon']) {
          const g = generateProperties(
            { g: { type: 'geometry', geometry_type: kind } as unknown as Property },
            ctx({ n, rng }),
          )['g'] as { coordinates: unknown };
          const flat =
            JSON.stringify(g.coordinates)
              .match(/-?\d+\.?\d*/g)
              ?.map(Number) ?? [];
          for (let i = 0; i < flat.length; i += 2) {
            const dx = ((flat[i] as number) - 10) * 111.32 * Math.cos((51 * Math.PI) / 180);
            const dy = ((flat[i + 1] as number) - 51) * 111.32;
            expect(Math.hypot(dx, dy)).toBeLessThan(1);
          }
        }
      }),
    );
  });
});

describe('spreadStage', () => {
  const type = {
    process: { property: 'stage', start: 'a', end: ['c'] },
    properties: { stage: { type: 'select', options: { a: 'A', b: 'B', c: 'C' } } },
  } as unknown as FeatureType;
  it('starts at the start stage, then walks the other stages', () => {
    expect([0, 1, 2, 3, 4].map((n) => spreadStage(type, n)?.stage)).toEqual(['a', 'b', 'c', 'b', 'c']);
  });
  it('is undefined without a process', () => {
    expect(spreadStage({ properties: {} } as unknown as FeatureType, 0)).toBeUndefined();
  });
});
