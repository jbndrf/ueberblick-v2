import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIFF_CHANGES } from '../../registry/compile';
import { diff, isOrderOnly } from './index';
import type { TemplateFile } from '../file';

const KEYS = ['a', 'b', 'c', 'd'] as const;
const file = (order: readonly string[], values: Record<string, number> = {}): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'k', version: '1' },
    types: { t: { properties: Object.fromEntries(order.map((k) => [k, { n: values[k] ?? 1 }])) } },
  }) as unknown as TemplateFile;

describe('isOrderOnly', () => {
  it('is false for no change, true for order changes only, false with any other kind', () => {
    expect(isOrderOnly([])).toBe(false);
    expect(isOrderOnly([{ change: 'order_changed' }, { change: 'order_changed' }])).toBe(true);
    for (const kind of DIFF_CHANGES.keys.filter((k) => k !== 'order_changed'))
      expect(isOrderOnly([{ change: 'order_changed' }, { change: kind }])).toBe(false);
  });

  it('property: reordering a map is order-only', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...KEYS], { minLength: 4, maxLength: 4 }), (order) => {
        const d = diff(file(KEYS), file(order));
        expect(isOrderOnly(d)).toBe(d.length > 0);
        expect(d.length).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('property: any value change makes it not order-only, reordered or not', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...KEYS], { minLength: 4, maxLength: 4 }),
        fc.constantFrom(...KEYS),
        fc.integer({ min: 2, max: 9 }),
        (order, key, n) => {
          const d = diff(file(KEYS), file(order, { [key]: n }));
          expect(d.some((e) => e.change === 'changed')).toBe(true);
          expect(isOrderOnly(d)).toBe(false);
        },
      ),
    );
  });
});
