import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import { pointFeature } from '../test-helpers';
import { splitChange } from './chunk';

const f = (i: number) => pointFeature(`f${i}`, i, i);

describe('splitChange', () => {
  it('keeps a small change whole', () => {
    const change = { add: [f(1)], update: [f(2)], remove: ['x' as FeatureId] };
    expect(splitChange(change, 10)).toEqual([change]);
  });

  it('yields nothing for an empty change', () => {
    expect(splitChange({ add: [], update: [], remove: [] }, 10)).toEqual([]);
  });

  it('property: parts are at most `size` big and concatenate to the original, in order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 1, max: 25 }),
        (a, u, r, size) => {
          const change = {
            add: Array.from({ length: a }, (_, i) => f(i)),
            update: Array.from({ length: u }, (_, i) => f(1000 + i)),
            remove: Array.from({ length: r }, (_, i) => `r${i}` as FeatureId),
          };
          const parts = splitChange(change, size);
          for (const p of parts)
            expect(p.add.length + p.update.length + p.remove.length).toBeLessThanOrEqual(size);
          expect(parts.flatMap((p) => p.add)).toEqual(change.add);
          expect(parts.flatMap((p) => p.update)).toEqual(change.update);
          expect(parts.flatMap((p) => p.remove)).toEqual(change.remove);
          // Order across kinds is add, then update, then remove.
          const kinds = parts.flatMap((p) => [
            ...p.add.map(() => 0),
            ...p.update.map(() => 1),
            ...p.remove.map(() => 2),
          ]);
          expect([...kinds].sort()).toEqual(kinds);
        },
      ),
    );
  });
});
