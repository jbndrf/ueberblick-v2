/**
 * `describeFactsConformance`: the one suite every `Facts` implementation must pass (WP-146), so a plan on the device and a
 * plan on the server see the same edges, related features and near results. Relation semantics (docs/04): the far end of
 * an edge exists and is not deleted, the same rule as the expr SQL join. Run it from the adapter's spec:
 * `describeFactsConformance('SQLite Facts', () => harness)`. Pure and synchronous; the adapter owns its storage.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { edgeKey } from '../fold';
import type { Bbox } from '../geo/contract';
import type { Edge, FeatureId, Key, RecordedObservation } from '../model';
import type { Facts } from '../ports';
import { erasureCases } from './facts-conformance-erasure';
import { ofTypeCases, pinCases } from './facts-conformance-oftype';
import { IDS, Model, fid, k, ob, op, point, square, toLog } from './facts-conformance-kit';
import { isServed } from '../registry/lifecycle';

export interface FactsHarness {
  readonly facts: Facts;
  /** The related features of `id` over `relation` (references, derived edges, inverse relations), as `FeatureAccess.related` reads them. */
  related(id: FeatureId, relation: Key): readonly FeatureId[];
  /** Folds `observations` (ascending seq, never seen before) into the store the way the adapter's write path does, `chunk` observations at a time. */
  apply(observations: readonly RecordedObservation[], chunk?: number): void;
  /**
   * Like `apply`, for the observations of one run made by `actorId` (every observation carries the same `runId`, seqs ascending):
   * the adapter records who made the run, as its write path does, so `observationsByActor` can find them.
   */
  applyBy(actorId: string, observations: readonly RecordedObservation[]): void;
  /** Releases the storage. */
  dispose?(): void;
}

const sorted = (edges: readonly Edge[]): string[] => edges.map(edgeKey).sort();
const ids = (features: Iterable<{ readonly id: string }>): string[] => [...features].map((f) => f.id).sort();
const strip = (f: {
  id: string;
  type: string;
  properties: unknown;
  lifecycle: string;
  updatedSeq: number;
}) => ({
  id: f.id,
  type: f.type,
  properties: f.properties,
  lifecycle: f.lifecycle,
  updatedSeq: f.updatedSeq,
});

/** A world with a plot, an area and two trees (one inside the area). */
const WORLD: readonly RecordedObservation[] = [
  ob('p0', '$type', 'plot', 1),
  ob('a0', '$type', 'area', 2),
  ob('a0', 'geometry', square(0, 0, 4), 3),
  ob('t0', '$type', 'tree', 4),
  ob('t0', 'plot', 'p0', 5),
  ob('t0', 'geometry', point(1, 1), 6),
  ob('t1', '$type', 'tree', 7),
  ob('t1', 'plot', 'p0', 8),
  ob('t1', 'geometry', point(9, 9), 9),
];

export function describeFactsConformance(name: string, make: () => FactsHarness): void {
  const fresh = (obs: readonly RecordedObservation[] = [], chunk = 100): FactsHarness => {
    const h = make();
    h.apply(obs, chunk);
    return h;
  };

  describe(`Facts conformance: ${name}`, () => {
    it('equals the brute-force model on random logs, applied in chunks', () => {
      fc.assert(
        fc.property(fc.array(op, { maxLength: 60 }), fc.integer({ min: 1, max: 25 }), (ops, chunk) => {
          const log = toLog(ops);
          const h = fresh(log, chunk);
          const model = new Model();
          model.apply(log);
          const { facts } = h;
          for (const id of IDS.map(fid)) {
            const want = model.features.get(id);
            const got = facts.feature(id);
            expect(got === undefined ? undefined : strip(got)).toEqual(
              want === undefined ? undefined : strip(want),
            );
            for (const rel of [undefined, k('plot'), k('area_of')]) {
              expect(sorted(facts.edgesFrom(id, rel))).toEqual(sorted(model.edgesFrom(id, rel)));
              expect(sorted(facts.edgesTo(id, rel))).toEqual(sorted(model.edgesTo(id, rel)));
            }
            // near and related parity: a relation set is the live far ends of the edges edgesFrom/edgesTo return.
            expect([...h.related(id, k('plot'))].sort()).toEqual(
              facts
                .edgesFrom(id, k('plot'))
                .map((e) => e.to)
                .sort(),
            );
            expect([...h.related(id, k('area_of'))].sort()).toEqual(
              facts
                .edgesFrom(id, k('area_of'))
                .map((e) => e.to)
                .sort(),
            );
            const storedBy: { [type: string]: Key } = { plot: k('plot'), area: k('area_of') };
            const stored = storedBy[want?.type ?? ''];
            if (stored !== undefined)
              expect([...h.related(id, k('trees'))].sort()).toEqual(
                facts
                  .edgesTo(id, stored)
                  .filter((e) => facts.feature(e.from)?.type === 'tree')
                  .map((e) => e.from)
                  .sort(),
              );
            for (const n of [1, 3, 100]) {
              expect(facts.history(id, 'name', n)).toEqual(model.history(id, 'name', n));
              expect(facts.history(id, 'geometry', n)).toEqual(model.history(id, 'geometry', n));
            }
          }
          expect(facts.feature(fid('nope'))).toBeUndefined();
          expect(h.related(fid('nope'), k('plot'))).toEqual([]);
          for (const type of ['tree', 'plot', 'area']) {
            const box: Bbox = [0, 0, 4, 4];
            expect(ids(facts.near(k(type), box))).toEqual(
              ids(
                [...model.features.values()].filter(
                  (f) =>
                    f.type === type &&
                    isServed(f.lifecycle) &&
                    Object.values(f.derived).some(
                      (d) => d.bbox[0] <= 4 && d.bbox[2] >= 0 && d.bbox[1] <= 4 && d.bbox[3] >= 0,
                    ),
                ),
              ),
            );
          }
          h.dispose?.();
        }),
        { numRuns: 60 },
      );
    });

    it('history with a limit of 0 or below returns nothing (SQLite LIMIT -1 would mean unlimited)', () => {
      const h = fresh([ob('t0', '$type', 'tree', 1), ob('t0', 'height', 10, 2), ob('t0', 'height', 20, 3)]);
      const t0 = fid('t0');
      expect(h.facts.history(t0, 'height', 0)).toEqual([]);
      expect(h.facts.history(t0, 'height', -1)).toEqual([]);
      expect(h.facts.history(t0, 'height', -100)).toEqual([]);
      expect(h.facts.history(t0, 'height', 1).map((o) => o.result)).toEqual([20]);
      h.dispose?.();
    });

    it('history is newest first and capped', () => {
      const h = fresh([
        ob('t0', '$type', 'tree', 1),
        ...[10, 20, 30, 40, 50].map((v, i) => ob('t0', 'height', v, i + 2)),
      ]);
      const t0 = fid('t0');
      expect(h.facts.history(t0, 'height', 3).map((o) => o.result)).toEqual([50, 40, 30]);
      expect(h.facts.history(t0, 'height', 99).map((o) => o.seq)).toEqual([6, 5, 4, 3, 2]);
      expect(h.facts.history(t0, 'none', 5)).toEqual([]);
      h.dispose?.();
    });

    it('covers references, derived edges and inverse relations', () => {
      const h = fresh(WORLD, 3);
      const t = (s: string): FeatureId => fid(s);
      expect(h.related(t('t0'), k('plot'))).toEqual(['p0']);
      expect(h.related(t('t0'), k('area_of'))).toEqual(['a0']);
      expect(h.related(t('t1'), k('area_of'))).toEqual([]);
      expect([...h.related(t('p0'), k('trees'))].sort()).toEqual(['t0', 't1']);
      expect(h.related(t('a0'), k('trees'))).toEqual(['t0']);
      expect(h.facts.edgesFrom(t('t0'), k('area_of'))).toEqual([
        { from: 't0', relation: 'area_of', to: 'a0', derived: true },
      ]);
      expect(sorted(h.facts.edgesTo(t('p0'), k('plot')))).toEqual(
        sorted([
          { from: fid('t0'), relation: k('plot'), to: fid('p0'), derived: false },
          { from: fid('t1'), relation: k('plot'), to: fid('p0'), derived: false },
        ]),
      );
      h.dispose?.();
    });

    describe('a dead far end (never created, or deleted)', () => {
      it('is skipped by edgesFrom, edgesTo and related, and comes back once restored', () => {
        const h = fresh([
          ob('p0', '$type', 'plot', 1),
          ob('t0', '$type', 'tree', 2),
          ob('t0', 'plot', 'p0', 3),
        ]);
        const [t0, p0] = [fid('t0'), fid('p0')];
        const plot = k('plot');
        expect(h.facts.edgesFrom(t0, plot).map((e) => e.to)).toEqual(['p0']);
        h.apply([ob('p0', '$lifecycle', 'deleted', 4)]);
        expect(h.facts.edgesFrom(t0, plot)).toEqual([]);
        expect(h.facts.edgesFrom(t0)).toEqual([]);
        expect(h.facts.edgesTo(p0, plot).map((e) => e.from)).toEqual(['t0']); // p0 itself is dead, its source is live
        expect(h.related(t0, plot)).toEqual([]);
        h.apply([ob('p0', '$lifecycle', 'active', 5), ob('t0', '$lifecycle', 'deleted', 6)]);
        expect(h.facts.edgesFrom(t0, plot).map((e) => e.to)).toEqual(['p0']);
        expect(h.facts.edgesTo(p0, plot)).toEqual([]); // the source is dead now
        expect(h.related(p0, k('trees'))).toEqual([]);
        h.apply([ob('t0', '$lifecycle', 'active', 7)]);
        expect(h.facts.edgesTo(p0, plot).map((e) => e.from)).toEqual(['t0']);
        expect(h.related(p0, k('trees'))).toEqual(['t0']);
        h.dispose?.();
      });

      it('skips an edge to a feature that was never created', () => {
        const h = fresh([ob('t0', '$type', 'tree', 1), ob('t0', 'plot', 'ghost', 2)]);
        expect(h.facts.edgesFrom(fid('t0'), k('plot'))).toEqual([]);
        expect(h.facts.edgesFrom(fid('t0'))).toEqual([]);
        expect(h.related(fid('t0'), k('plot'))).toEqual([]);
        h.apply([ob('ghost', '$type', 'plot', 3)]); // created later: the edge shows up
        expect(h.facts.edgesFrom(fid('t0'), k('plot')).map((e) => e.to)).toEqual(['ghost']);
        h.dispose?.();
      });

      it('skips a derived edge to a deleted area, and finds it again when the tree moves back in', () => {
        const h = fresh(WORLD);
        h.apply([ob('a0', '$lifecycle', 'deleted', 10)]);
        expect(h.facts.edgesFrom(fid('t0'), k('area_of'))).toEqual([]);
        expect(h.related(fid('t0'), k('area_of'))).toEqual([]);
        h.apply([ob('t0', 'geometry', point(20, 20), 11)]); // leaves the (deleted) area
        h.apply([ob('a0', '$lifecycle', 'active', 12)]);
        expect(h.facts.edgesFrom(fid('t0'), k('area_of'))).toEqual([]); // no stale edge survives
        h.apply([ob('t0', 'geometry', point(2, 2), 13)]);
        expect(h.facts.edgesFrom(fid('t0'), k('area_of')).map((e) => e.to)).toEqual(['a0']);
        h.dispose?.();
      });
      it('drops a stale derived edge to an area that stays deleted, whatever the tree does next', () => {
        const h = fresh([
          ...WORLD,
          ob('a1', '$type', 'area', 10),
          ob('a1', 'geometry', square(10, 10, 4), 11),
        ]);
        h.apply([ob('a0', '$lifecycle', 'deleted', 12)]);
        h.apply([ob('t0', 'geometry', point(20, 20), 13)]); // recompute runs while a0 is dead
        expect(h.facts.edgesFrom(fid('t0'), k('area_of'))).toEqual([]);
        expect(h.facts.edgesTo(fid('a0'), k('area_of'))).toEqual([]);
        expect(h.related(fid('a0'), k('trees'))).toEqual([]);
        h.apply([ob('t0', 'geometry', point(11, 11), 14)]); // into the other area
        expect(
          h.facts
            .edgesFrom(fid('t0'))
            .map((e) => e.to)
            .sort(),
        ).toEqual(['a1', 'p0']);
        expect(h.facts.edgesFrom(fid('t0'), k('area_of')).map((e) => e.to)).toEqual(['a1']);
        expect(h.facts.edgesTo(fid('a0'))).toEqual([]);
        h.dispose?.();
      });
    });

    erasureCases(() => make());
    ofTypeCases(() => make());
    pinCases(() => make());

    describe('near', () => {
      it('filters by type and skips deleted features and features without geometry', () => {
        const h = fresh([
          ob('t0', '$type', 'tree', 1),
          ob('t0', 'geometry', point(1, 1), 2),
          ob('t1', '$type', 'tree', 3),
          ob('t2', '$type', 'tree', 4),
          ob('t2', 'geometry', point(1, 1), 5),
          ob('t2', '$lifecycle', 'deleted', 6),
          ob('a0', '$type', 'area', 7),
          ob('a0', 'geometry', square(0, 0, 3), 8),
        ]);
        expect(ids(h.facts.near(k('tree'), [0, 0, 2, 2]))).toEqual(['t0']);
        expect(ids(h.facts.near(k('area'), [0, 0, 2, 2]))).toEqual(['a0']);
        expect(ids(h.facts.near(k('area'), [5, 5, 6, 6]))).toEqual([]);
        h.apply([ob('t2', '$lifecycle', 'active', 9)]);
        expect(ids(h.facts.near(k('tree'), [0, 0, 2, 2]))).toEqual(['t0', 't2']);
        h.dispose?.();
      });

      it('counts edge contact as intersecting', () => {
        const h = fresh([ob('t0', '$type', 'tree', 1), ob('t0', 'geometry', point(1, 1), 2)]);
        expect(ids(h.facts.near(k('tree'), [1, 1, 3, 3]))).toHaveLength(1);
        expect(ids(h.facts.near(k('tree'), [-2, -2, 1, 1]))).toHaveLength(1);
        expect(ids(h.facts.near(k('tree'), [1.1, 1, 3, 3]))).toHaveLength(0);
        h.dispose?.();
      });

      it('finds a feature through any of its geometry properties, primary or not (B-009)', () => {
        const h = fresh([
          ob('m0', '$type', 'multi', 1),
          ob('m0', 'aaa_extra', point(9, 9), 2),
          ob('m0', 'footprint', square(0, 0, 2), 3),
          ob('n0', '$type', 'multi', 4),
          ob('n0', 'aaa_extra', point(50, 50), 5),
        ]);
        expect(ids(h.facts.near(k('multi'), [8, 8, 10, 10]))).toEqual(['m0']);
        expect(ids(h.facts.near(k('multi'), [0, 0, 1, 1]))).toEqual(['m0']);
        expect(ids(h.facts.near(k('multi'), [49, 49, 51, 51]))).toEqual(['n0']);
        h.dispose?.();
      });
    });
  });
}
