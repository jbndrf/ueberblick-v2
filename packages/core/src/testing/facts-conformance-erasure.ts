/**
 * The erasure reads of the Facts conformance suite (WP-534.1): `observationsByActor` and `featuresWith`. Split from
 * `facts-conformance.ts` for size; called from `describeFactsConformance`.
 */
import { describe, expect, it } from 'vitest';
import type { Json, RecordedObservation, RunId } from '../model';
import { fid, k, ob } from './facts-conformance-kit';
import type { FactsHarness } from './facts-conformance';

const at = (o: RecordedObservation, runId: string): RecordedObservation => ({ ...o, runId: runId as RunId });
const ids = (features: Iterable<{ readonly id: string }>): string[] => [...features].map((f) => f.id).sort();
const shape = (list: readonly RecordedObservation[]) =>
  list.map((o) => ({
    seq: o.seq,
    run: o.runId,
    feature: o.featureId,
    property: o.property,
    result: o.result,
  }));

export function erasureCases(fresh: () => FactsHarness): void {
  describe('observationsByActor', () => {
    it('lists the observations of the runs an actor made, ascending by seq, and none for anyone else', () => {
      const h = fresh();
      h.applyBy('anna', [at(ob('t0', '$type', 'tree', 1), 'ra1'), at(ob('t0', 'name', 'Eiche', 2), 'ra1')]);
      h.applyBy('bernd', [at(ob('t1', '$type', 'tree', 3), 'rb1'), at(ob('t1', 'name', 'Buche', 4), 'rb1')]);
      h.applyBy('anna', [at(ob('t1', 'height', 7, 5), 'ra2')]);
      expect(shape(h.facts.observationsByActor('anna'))).toEqual([
        { seq: 1, run: 'ra1', feature: fid('t0'), property: '$type', result: 'tree' },
        { seq: 2, run: 'ra1', feature: fid('t0'), property: 'name', result: 'Eiche' },
        { seq: 5, run: 'ra2', feature: fid('t1'), property: 'height', result: 7 },
      ]);
      expect(shape(h.facts.observationsByActor('bernd')).map((o) => o.seq)).toEqual([3, 4]);
      expect(h.facts.observationsByActor('nobody')).toEqual([]);
      h.dispose?.();
    });
  });

  describe('createdBy (WP-639 quota)', () => {
    it('counts the live features an actor created, stops at the limit, and is freed by a delete', () => {
      const h = fresh();
      // plan writes `$created_by` (the actor of the run, `creatorOf`, WP-306) beside `$type` on a create
      const born = (f: string, who: string, seq: number, run: string): RecordedObservation[] => [
        at(ob(f, '$type', 'tree', seq), run),
        at(ob(f, '$created_by', who, seq + 1), run),
      ];
      h.applyBy('anna', [...born('t0', 'anna', 1, 'ra1'), at(ob('t0', 'name', 'Eiche', 3), 'ra1')]);
      h.applyBy('anna', born('t1', 'anna', 4, 'ra2'));
      h.applyBy('anna', born('t2', 'anna', 6, 'ra3'));
      h.applyBy('bernd', born('t3', 'bernd', 8, 'rb1'));
      expect(h.facts.createdBy('anna', 10)).toBe(3);
      expect(h.facts.createdBy('anna', 2)).toBe(2);
      expect(h.facts.createdBy('anna', 0)).toBe(0);
      expect(h.facts.createdBy('bernd', 10)).toBe(1);
      expect(h.facts.createdBy('nobody', 10)).toBe(0);
      h.applyBy('anna', [at(ob('t1', '$lifecycle', 'deleted', 10), 'ra4')]);
      expect(h.facts.createdBy('anna', 10)).toBe(2);
      h.dispose?.();
    });
  });

  describe('featuresWith', () => {
    const world = (): FactsHarness => {
      const h = fresh();
      const o = (f: string, p: string, v: Json, seq: number) => ob(f, p, v, seq);
      h.apply([
        o('t0', '$type', 'tree', 1),
        o('t0', 'name', 'Eiche', 2),
        o('t1', '$type', 'tree', 3),
        o('t1', 'name', 'Eiche', 4),
        o('t2', '$type', 'tree', 5),
        o('t2', 'name', 'Buche', 6),
        o('t3', '$type', 'tree', 7),
        o('t3', 'name', 'Eiche', 8),
        o('t3', '$lifecycle', 'deleted', 9),
        o('p0', '$type', 'plot', 10),
        o('p0', 'name', 'Eiche', 11),
        o('t4', '$type', 'tree', 12),
        o('t4', 'height', 7, 13),
        o('t5', '$type', 'tree', 14),
        o('t5', 'name', null, 15),
      ]);
      return h;
    };

    it('finds live features of the type holding exactly that value, in id order', () => {
      const h = world();
      expect([...h.facts.featuresWith(k('tree'), 'name', 'Eiche')].map((f) => f.id)).toEqual(['t0', 't1']);
      expect(ids(h.facts.featuresWith(k('tree'), 'name', 'Buche'))).toEqual(['t2']);
      expect(ids(h.facts.featuresWith(k('plot'), 'name', 'Eiche'))).toEqual(['p0']);
      expect(ids(h.facts.featuresWith(k('tree'), 'height', 7))).toEqual(['t4']);
      expect(ids(h.facts.featuresWith(k('tree'), 'name', 'Ulme'))).toEqual([]);
      h.dispose?.();
    });

    it('matches a value that was erased to null', () => {
      const h = world();
      expect(ids(h.facts.featuresWith(k('tree'), 'name', null))).toContain('t5');
      h.dispose?.();
    });

    it('a value of another JSON type does not match (the string "7" is not 7)', () => {
      const h = world();
      expect(ids(h.facts.featuresWith(k('tree'), 'height', '7'))).toEqual([]);
      h.dispose?.();
    });
  });
}
