/**
 * Budget (docs/12-performance-budgets.md, WP-677, B-019): opening a relation whose children sit at their parent fans
 * them out above the parent. The work is the family's reads for the children of the opened parent (each child's type,
 * its parent edge, the parent's anchor) and the fan order, so it is O(children of the opened parent), never O(all
 * features): the same parent with the same children costs the same in 60k and in 6k features. The map markers the fan
 * puts are capped (FAN_CAP + 1), so the DOM part does not grow with the children. Judged at the x4 factor against the
 * long-task row (100 ms); the interaction it belongs to is the 200 ms tap-to-paint row.
 * Run: npm test -- -c bench/vitest.config.ts bench/map-family
 */
import { describe, it } from 'vitest';
import type { Edge, FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { inheritRelations } from '@ueberblick/core/schema';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { createFamily, fanOf, type FanInput } from '../../packages/ui/src/map/family';

const TYPES = {
  baum: {
    relations: { massnahmen: { to: 'massnahme', inverse_of: 'massnahme.baum', inherit_position: true } },
  },
  massnahme: {},
} as const;

const id = (s: string): FeatureId => s as FeatureId;

/** `total` trees, tree 0 with `children` measures at it. The facts index edges by `from`, as the device does. */
function build(total: number, children: number) {
  const states = new Map<string, FeatureState>();
  const edges = new Map<string, Edge[]>();
  for (let i = 0; i < total; i++) {
    states.set(`b${i}`, {
      id: id(`b${i}`),
      type: 'baum' as Key,
      lifecycle: 'active',
      updatedSeq: 1,
      properties: { standort: { type: 'Point', coordinates: [5 + (i % 1000) / 100, 47 + (i % 800) / 100] } },
    } as FeatureState);
  }
  const ids: FeatureId[] = [];
  for (let i = 0; i < children; i++) {
    const m = `m${i}`;
    states.set(m, {
      id: id(m),
      type: 'massnahme' as Key,
      lifecycle: i % 3 === 0 ? 'completed' : 'active',
      updatedSeq: 1,
      changedAt: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`,
      properties: { baum: 'b0' },
    } as unknown as FeatureState);
    edges.set(m, [{ from: id(m), relation: 'baum' as Key, to: id('b0'), derived: false }]);
    ids.push(id(m));
  }
  const family = createFamily(inheritRelations(TYPES), {
    feature: (f) => states.get(f),
    edgesFrom: (f) => edges.get(f) ?? [],
    ownAnchor: (f) => {
      const g = states.get(f)?.properties['standort'] as { coordinates: [number, number] } | undefined;
      return g?.coordinates;
    },
  });
  return { family, ids, states };
}

/** One open of the relation: the anchors of the children and the fan order. Median of 15. */
function openMedian(total: number, children: number): number {
  const { family, ids, states } = build(total, children);
  const samples: number[] = [];
  for (let run = 0; run < 15; run++) {
    const t0 = performance.now();
    const inputs: FanInput[] = [];
    for (const f of ids) {
      if (family.anchorOf(f) === undefined) continue;
      const s = states.get(f) as FeatureState;
      inputs.push({
        id: f,
        active: s.lifecycle === 'active',
        ...(s.changedAt ? { changedAt: s.changedAt } : {}),
      });
    }
    fanOf(inputs);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[7] ?? 0;
}

describe('map-family', () => {
  it('open a relation of 2,000 children at their parent: <= 100 ms at x4, the same at 6k and 60k features', () => {
    const big = openMedian(60_000, 2_000);
    const small = openMedian(6_000, 2_000);
    const few = openMedian(60_000, 20);
    console.log(
      `bench map-family open: 60k features / 2000 children ${big.toFixed(2)} ms; 6k features / 2000 children ${small.toFixed(2)} ms; 60k features / 20 children ${few.toFixed(3)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-family-open-2000',
          limit: 100,
          unit: 'ms',
          derivedFrom: 'long-task: opening a relation fans out the children of the opened parent only',
          device: 'x4',
          thread: 'main',
        }),
        Number(big.toFixed(2)),
      ),
    );
  });
});
