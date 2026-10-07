import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ORDERED_MAPS } from '../../registry/compile';
import { orderSignature } from '../../template/order';
import { diff } from './index';
import type { TemplateFile } from '../file';

/** Every entry in `ORDERED_MAPS` is exercised here: a new entry is tested without a new test (A-042). */
const KEYS = ['a', 'b', 'c', 'd'] as const;

/** A file with one ordered map at `pattern` (`*` is the key `x`) holding `keys` in that order. */
function fileWith(pattern: string, keys: readonly string[]): TemplateFile {
  const leaf = Object.fromEntries(keys.map((k) => [k, { n: 1 }]));
  const segs = pattern.split('.').map((s) => (s === '*' ? 'x' : s));
  const root: Record<string, unknown> = {};
  let node = root;
  segs.forEach((s, i) => {
    node[s] = i === segs.length - 1 ? leaf : {};
    node = node[s] as Record<string, unknown>;
  });
  return root as unknown as TemplateFile;
}

describe('ORDERED_MAPS: every entry is an order change (A-042)', () => {
  it('names the maps the app reads in file order', () => {
    for (const p of ['roles.*.app.tools', 'tools', 'roles.*.app.filter_presets', 'tasks.*.auto', 'map.packs'])
      expect(ORDERED_MAPS.keys).toContain(p);
  });

  for (const pattern of ORDERED_MAPS.keys) {
    it(`${pattern}: one non-breaking order_changed entry, none for the same order`, () => {
      const path = pattern.replace(/\*/g, 'x');
      fc.assert(
        fc.property(fc.shuffledSubarray([...KEYS], { minLength: 4, maxLength: 4 }), (order) => {
          const a = fileWith(pattern, KEYS);
          const b = fileWith(pattern, order);
          const d = diff(a, b);
          if (order.every((k, i) => k === KEYS[i])) {
            expect(d).toEqual([]);
            expect(orderSignature(a)).toEqual(orderSignature(b));
          } else {
            expect(d).toHaveLength(1);
            expect(d[0]).toMatchObject({
              path,
              change: 'order_changed',
              breaking: false,
              before: [...KEYS],
              after: order,
            });
            expect(orderSignature(a)).not.toEqual(orderSignature(b));
          }
        }),
        { numRuns: 30 },
      );
    });
  }
});
