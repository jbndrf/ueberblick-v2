// WP-104: after every submit, features/edges/feature_bbox equal a from-scratch core.fold of the observations.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Actor, FeatureId, Json } from '@ueberblick/core';
import { IDS, anna, bernd, seedMusterstadt, setup, vera, type Ctx } from './testkit';
import { mismatches } from './verify.testkit';

/** Points on a coarse grid around the park (7.100..7.110, 50.730..50.740), boundaries included. */
const px = fc.integer({ min: 0, max: 8 }).map((i) => (7096 + i * 2) / 1000);
const py = fc.integer({ min: 0, max: 8 }).map((i) => (50726 + i * 2 + (i % 2)) / 1000);
const point = fc.tuple(px, py).map(([x, y]): Json => ({ type: 'Point', coordinates: [x, y] }));
const box = fc.tuple(px, py, fc.integer({ min: 1, max: 4 })).map(([x, y, d]): Json => {
  const w = d * 0.002;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + w, y],
        [x + w, y + w],
        [x, y + w],
        [x, y],
      ],
    ],
  };
});

type Op =
  | { kind: 'erfassen'; geometrie: Json; who: number }
  | { kind: 'verschieben'; tree: number; geometrie: Json }
  | { kind: 'flaeche'; geometrie: Json }
  | { kind: 'kontrolle'; tree: number; vitalitaet: string; befund: number }
  | { kind: 'batch'; geometries: Json[] }
  | { kind: 'refused'; tree: number }
  | { kind: 'erledigen'; measure: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({ kind: fc.constant('erfassen' as const), geometrie: point, who: fc.nat(1) }),
  },
  {
    weight: 4,
    arbitrary: fc.record({ kind: fc.constant('verschieben' as const), tree: fc.nat(20), geometrie: point }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('flaeche' as const), geometrie: box }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('kontrolle' as const),
      tree: fc.nat(20),
      vitalitaet: fc.constantFrom('v1', 'v2', 'v3', 'v4'),
      befund: fc.nat(5),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('batch' as const),
      geometries: fc.array(point, { minLength: 1, maxLength: 4 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('refused' as const), tree: fc.nat(20) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('erledigen' as const), measure: fc.nat(10) }) },
);

const ids = (c: Ctx, type: string): FeatureId[] =>
  c.db
    .prepare<{ id: string }>(
      "SELECT id FROM features WHERE type = ? AND lifecycle IN ('active','completed') ORDER BY id",
    )
    .all(type)
    .map((r) => r.id as FeatureId);
/** Every run carries a client time (as the device queue stamps it), so the audit times are exercised too. */
let tick = 0;
const timed = (c: Ctx, task: string, who: Actor, input: Record<string, Json>, feature?: FeatureId) =>
  c.run(task, who, input, feature, {
    clientTime: new Date(Date.UTC(2026, 4, 1, 8, 0, ++tick)).toISOString(),
  });
const pick = <T>(list: readonly T[], n: number): T | undefined => list[n % Math.max(1, list.length)];

/** Submits one operation; true when it was accepted. */
function apply(c: Ctx, o: Op): boolean {
  const trees = ids(c, 'baum');
  switch (o.kind) {
    case 'erfassen':
      return ok(
        c.store.submit(
          timed(c, 'erfassen', o.who === 0 ? anna : vera, { vitalitaet: 'v2', geometrie: o.geometrie }),
        ),
      );
    case 'verschieben':
      return ok(
        c.store.submit(timed(c, 'verschieben', vera, { geometrie: o.geometrie }, pick(trees, o.tree))),
      );
    case 'flaeche':
      return ok(c.store.submit(timed(c, 'flaeche_bearbeiten', vera, { geometrie: o.geometrie }, IDS.park)));
    case 'kontrolle': {
      const t = pick(trees, o.tree) as FeatureId;
      const before = c.store.facts.feature(t)?.properties['befund'];
      const befund = `befund ${o.befund}`;
      return ok(
        c.store.submit(
          timed(
            c,
            'kontrolle',
            anna,
            { vitalitaet: o.vitalitaet, befund: befund === before ? `${befund}!` : befund },
            t,
          ),
        ),
      );
    }
    case 'batch':
      return (
        c.store.submitBatch(
          o.geometries.map((g) => timed(c, 'erfassen', vera, { vitalitaet: 'v1', geometrie: g })),
        ).outcome === 'accepted'
      );
    case 'refused':
      return ok(
        c.store.submit(timed(c, 'kontrolle', bernd, { vitalitaet: 'v1', befund: 'x' }, pick(trees, o.tree))),
      );
    case 'erledigen': {
      const m = pick(ids(c, 'massnahme'), o.measure);
      return m !== undefined && ok(c.store.submit(timed(c, 'massnahme_erledigen', bernd, {}, m)));
    }
  }
}
const ok = (r: { outcome: string }): boolean => r.outcome === 'accepted';

describe('features, edges and bbox equal a from-scratch fold (property)', () => {
  it('after every submit of a random run sequence', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 18 }), (ops) => {
        const c = setup();
        seedMusterstadt(c);
        expect(mismatches(c)).toEqual([]);
        for (const o of ops) {
          apply(c, o);
          const bad = mismatches(c);
          if (bad.length > 0) throw new Error(`${JSON.stringify(o)}: ${JSON.stringify(bad[0])}`);
        }
        c.db.close();
      }),
      { numRuns: 30 },
    );
  });

  // Coverage guard: a fixed op list, so it does not depend on what the generator happens to draw.
  // Proves the equivalence is not vacuous: accepted and refused operations both occur and both keep it.
  it('holds for a fixed sequence with accepted and refused operations', () => {
    const c = setup();
    seedMusterstadt(c);
    const pt: Json = { type: 'Point', coordinates: [7.1, 50.73] };
    const fixed: { op: Op; accepted: boolean }[] = [
      { op: { kind: 'erfassen', geometrie: pt, who: 0 }, accepted: true },
      { op: { kind: 'refused', tree: 0 }, accepted: false },
      { op: { kind: 'verschieben', tree: 0, geometrie: pt }, accepted: true },
      { op: { kind: 'batch', geometries: [pt, pt] }, accepted: true },
    ];
    // anna is assigned to the seeded tree t_in, so this kontrolle, before any tree moves is accepted
    const kontrolle = c.store.submit(
      timed(c, 'kontrolle', anna, { vitalitaet: 'v3', befund: 'neu' }, IDS.t_in),
    );
    expect(kontrolle.outcome).toBe('accepted');
    expect(mismatches(c)).toEqual([]);
    for (const { op: o, accepted } of fixed) {
      expect(apply(c, o), o.kind).toBe(accepted);
      expect(mismatches(c), o.kind).toEqual([]);
    }
    c.db.close();
  });
});
