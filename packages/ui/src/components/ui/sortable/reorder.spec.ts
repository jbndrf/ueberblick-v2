import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { arrange, DROP_POSITIONS, moveBy, moveWithin, positionAt, sameOrder } from './reorder';

const keysArb = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 12 });
const sorted = (k: readonly string[]): string[] => [...k].sort();

describe('moveWithin', () => {
  it('puts the dragged key before or after the target', () => {
    expect(moveWithin(['a', 'b', 'c', 'd'], 'a', 'c', 'before')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveWithin(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveWithin(['a', 'b', 'c', 'd'], 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveWithin(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b']);
    expect(moveWithin(['a', 'b'], 'x', 'a', 'after')).toEqual(['a', 'b']);
  });

  it('is a permutation: the same keys, none lost or doubled', () => {
    fc.assert(
      fc.property(keysArb, fc.nat(), fc.nat(), fc.constantFrom(...DROP_POSITIONS), (keys, i, j, pos) => {
        if (keys.length === 0) return;
        const [drag, target] = [keys[i % keys.length] as string, keys[j % keys.length] as string];
        const out = moveWithin(keys, drag, target, pos);
        expect(sorted(out)).toEqual(sorted(keys));
        if (drag !== target) {
          const [d, t] = [out.indexOf(drag), out.indexOf(target)];
          expect(pos === 'before' ? d === t - 1 : d === t + 1).toBe(true);
        }
      }),
    );
  });
});

describe('moveBy', () => {
  it('moves one place and stops at either end', () => {
    expect(moveBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveBy(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'b', 'c']);
  });

  it('is a permutation and undone by the opposite move', () => {
    fc.assert(
      fc.property(keysArb, fc.nat(), fc.constantFrom(-1 as const, 1 as const), (keys, i, delta) => {
        if (keys.length === 0) return;
        const key = keys[i % keys.length] as string;
        const out = moveBy(keys, key, delta);
        expect(sorted(out)).toEqual(sorted(keys));
        if (!sameOrder(out, keys)) expect(moveBy(out, key, delta === 1 ? -1 : 1)).toEqual(keys);
      }),
    );
  });
});

describe('positionAt', () => {
  it('is before above the middle and after below it', () => {
    expect(positionAt(10, 0, 40)).toBe('before');
    expect(positionAt(30, 0, 40)).toBe('after');
    expect(positionAt(20, 0, 40)).toBe('after');
  });
});

describe('arrange', () => {
  const items = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
  it('lists the items in the order of the keys; unnamed ones follow, unknown keys are skipped', () => {
    expect(arrange(items, (i) => i.k, ['c', 'a', 'b']).map((i) => i.k)).toEqual(['c', 'a', 'b']);
    expect(arrange(items, (i) => i.k, ['b', 'zz']).map((i) => i.k)).toEqual(['b', 'a', 'c']);
  });

  it('property: any order of the keys gives the same items in that order', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(['a', 'b', 'c'], { minLength: 3, maxLength: 3 }), (order) => {
        expect(arrange(items, (i) => i.k, order).map((i) => i.k)).toEqual(order);
      }),
    );
  });
});
