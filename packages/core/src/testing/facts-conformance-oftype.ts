/**
 * `Facts.ofType` of the conformance suite (WP-594): every live feature of a type, with or without geometry. Split from
 * `facts-conformance.ts` for size; called from `describeFactsConformance`.
 */
import { describe, expect, it } from 'vitest';
import { fid, k, ob } from './facts-conformance-kit';
import type { FactsHarness } from './facts-conformance';

const ids = (features: Iterable<{ readonly id: string }>): string[] => [...features].map((f) => f.id).sort();

export function ofTypeCases(fresh: () => FactsHarness): void {
  describe('ofType', () => {
    it('lists live features of the type, with or without geometry, and no deleted or other types', () => {
      const h = fresh();
      h.apply([
        ob('w0', '$type', 'order', 1),
        ob('w0', 'title', 'Repair', 2),
        ob('w1', '$type', 'order', 3),
        ob('w2', '$type', 'order', 4),
        ob('w2', '$lifecycle', 'deleted', 5),
        ob('p0', '$type', 'plot', 6),
      ]);
      expect(ids(h.facts.ofType(k('order')))).toEqual(['w0', 'w1']);
      expect(ids(h.facts.ofType(k('plot')))).toEqual(['p0']);
      expect(ids(h.facts.ofType(k('none')))).toEqual([]);
      h.dispose?.();
    });
  });
}

/** The version pin of a feature (`$version`, A-029): set, re-set, cleared, never a property. In the kit since WP-315. */
export function pinCases(fresh: () => FactsHarness): void {
  describe('version pin', () => {
    it('pin, re-pin, unpin; never a property', () => {
      const h = fresh();
      h.apply([ob('t0', '$type', 'tree', 1)]);
      const pin = (): number | undefined => h.facts.feature(fid('t0'))?.pinnedVersion;
      expect(pin()).toBeUndefined();
      h.apply([ob('t0', '$version', 2, 2)]);
      expect(pin()).toBe(2);
      h.apply([ob('t0', '$version', 3, 3)]);
      expect(pin()).toBe(3);
      expect(h.facts.feature(fid('t0'))?.properties).not.toHaveProperty('$version');
      h.apply([ob('t0', '$version', null, 4)]);
      expect(pin()).toBeUndefined();
      h.dispose?.();
    });
  });
}
