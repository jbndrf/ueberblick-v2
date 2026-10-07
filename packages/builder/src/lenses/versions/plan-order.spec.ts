import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TemplateFile } from '@ueberblick/core';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { buildPlan } from './plan';

type Props = Record<string, unknown>;
interface Loose {
  types: Record<string, { label: unknown; properties: Props }>;
}

const BASE = openProject(musterstadt.templateSrc, musterstadt.overlaySrc).effective();
const base = (): TemplateFile => BASE;
const baum = (f: Loose): Loose['types'][string] => f.types['baum'] as Loose['types'][string];
const edit = (fn: (f: Loose) => void): TemplateFile => {
  const f = structuredClone(base());
  fn(f as unknown as Loose);
  return f;
};
const reorder = (f: Loose, order: readonly string[]): void => {
  const props = baum(f).properties;
  baum(f).properties = Object.fromEntries(order.map((k) => [k, props[k]]));
};
const keys = (): string[] => Object.keys(base().types?.['baum']?.properties ?? {});
const counts = { baum: 7 };
const relabel = (f: Loose): void => {
  baum(f).label = { de: 'Baum neu', en: 'Tree new' };
};

describe('buildPlan: an order-only type is not affected (WP-411)', () => {
  it('stays listed as changed, with the order_changed line, but has no feature count', () => {
    const next = edit((f) => reorder(f, [...keys()].reverse()));
    const plan = buildPlan({ deployed: base(), effective: next, featureCounts: counts });
    expect(plan.entities.map((e) => e.entity)).toEqual(['baum']);
    expect(plan.entities[0]?.changes.map((c) => c.change)).toEqual(['order_changed']);
    expect(plan.affected).toEqual([]);
  });

  it('an order change plus another change in the same type is still affected', () => {
    const next = edit((f) => {
      reorder(f, [...keys()].reverse());
      relabel(f);
    });
    const plan = buildPlan({ deployed: base(), effective: next, featureCounts: counts });
    expect(plan.affected).toEqual([{ type: 'baum', features: 7 }]);
  });

  it('property: adding order_changed entries never changes affected', () => {
    const without = buildPlan({ deployed: base(), effective: edit(relabel), featureCounts: counts });
    fc.assert(
      fc.property(fc.shuffledSubarray(keys(), { minLength: 2 }), (order) => {
        const all = [...order, ...keys().filter((k) => !order.includes(k))];
        const only = buildPlan({
          deployed: base(),
          effective: edit((f) => reorder(f, all)),
          featureCounts: counts,
        });
        expect(only.affected).toEqual([]);
        const plus = buildPlan({
          deployed: base(),
          effective: edit((f) => {
            reorder(f, all);
            relabel(f);
          }),
          featureCounts: counts,
        });
        expect(plus.affected).toEqual(without.affected);
      }),
      { numRuns: 30 },
    );
  });
});
