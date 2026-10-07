/**
 * `Overlay.ofType` (WP-594): every live feature of a type as the plan sees it — the base features minus what the
 * batch removed, plus the batch's own puts. The shared Facts conformance suite folds committed logs into the memory
 * and SQLite stores; the Overlay folds a batch in-memory through `apply`, so its overlay semantics are covered
 * here, against the golden musterstadt world.
 */
import { describe, expect, it } from 'vitest';
import { createGeo } from '../geo';
import { createFold } from '../fold';
import type { Key } from '../model';
import { foldSchema } from '../schema/compile/views';
import { NOW, IDS, fid, rid, musterstadt } from './__fixtures__/world';
import { Overlay } from './overlay';

const k = (s: string): Key => s as Key;
const ids = (features: Iterable<{ readonly id: string }>): string[] => [...features].map((f) => f.id).sort();

const overlay = (): Overlay => {
  const { config, world } = musterstadt();
  return new Overlay(world, createFold(createGeo()), foldSchema(config, 0), config, {
    clock: { now: () => NOW },
    geo: createGeo(),
  });
};

describe('Overlay.ofType', () => {
  it('returns the base features of the type', () => {
    const o = overlay();
    expect(ids(o.ofType(k('baum')))).toEqual([IDS.t_in, IDS.t_hole, IDS.t_out].sort());
  });

  it('adds a live put of the type', () => {
    const o = overlay();
    const id = fid(90);
    o.apply(rid(90), [
      { featureId: id, property: '$type', result: 'baum' },
      { featureId: id, property: 'geometrie', result: { type: 'Point', coordinates: [7.115, 50.745] } },
    ]);
    expect(ids(o.ofType(k('baum')))).toEqual([id, IDS.t_in, IDS.t_hole, IDS.t_out].sort());
  });

  it('hides a base feature the batch deleted', () => {
    const o = overlay();
    o.apply(rid(91), [{ featureId: IDS.t_hole, property: '$lifecycle', result: 'deleted' }]);
    expect(ids(o.ofType(k('baum')))).toEqual([IDS.t_in, IDS.t_out].sort());
  });

  it('includes a feature without geometry', () => {
    const o = overlay();
    // `baumart` declares no geometry property: the base `linde` is still a row of its own type
    expect(ids(o.ofType(k('baumart')))).toEqual([IDS.linde]);
    const id = fid(92);
    o.apply(rid(92), [{ featureId: id, property: '$type', result: 'baum' }]);
    expect(ids(o.ofType(k('baum')))).toContain(id);
  });

  it('excludes features of another type', () => {
    const o = overlay();
    expect(ids(o.ofType(k('baum')))).not.toContain(IDS.park);
    expect(ids(o.ofType(k('baum')))).not.toContain(IDS.linde);
    expect(ids(o.ofType(k('flaeche')))).toEqual([IDS.park]);
  });
});
