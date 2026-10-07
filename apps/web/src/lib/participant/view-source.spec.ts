import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { goldenConfig } from '@ueberblick/core/testing';
import type { FeatureChange } from '@ueberblick/ui';
import { ALL, type Changed } from './changed';
import { drawnLooks, createViewSource } from './view-source';
import { isServed } from '@ueberblick/core';
import { lookOf } from './sheets/filter/filter-model';
import { LOOK_KEY } from '@ueberblick/core/marker';

const config: CompiledConfig = goldenConfig('templates/baumkataster/1.0.0.yaml');
const geo = createGeo();
const anna: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
const fid = (n: number) => `f${n}` as FeatureId;

const tree = (n: number, lon: number, extra: Record<string, unknown> = {}): FeatureState => ({
  id: fid(n),
  type: 'baum' as Key,
  properties: { geometrie: { type: 'Point', coordinates: [lon, 50.7] }, stage: 'erfasst', ...extra } as never,
  lifecycle: 'active',
  updatedSeq: n,
});
const area = (n: number): FeatureState => ({
  id: fid(n),
  type: 'flaeche' as Key,
  properties: {
    geometrie: {
      type: 'Polygon',
      coordinates: [
        [
          [7, 50],
          [8, 50],
          [8, 51],
          [7, 51],
          [7, 50],
        ],
      ],
    },
  } as never,
  lifecycle: 'active',
  updatedSeq: n,
});

function world(initial: FeatureState[]) {
  const states = new Map(initial.map((f) => [f.id, f]));
  const rings = new Set<(c: Changed) => void>();
  const walks = { count: 0 };
  const boxes: (readonly number[] | undefined)[] = [];
  return {
    states,
    set: (f: FeatureState) => states.set(f.id, f),
    walks,
    boxes,
    ring: (c: Changed = ALL) => rings.forEach((r) => r(c)),
    facts: {
      feature: (id: FeatureId) => states.get(id),
      near: (type: Key, bbox?: readonly number[]) => {
        walks.count++;
        boxes.push(bbox);
        return [...states.values()].filter((f) => f.type === type);
      },
      ofType: (type: Key) => [...states.values()].filter((f) => f.type === type && isServed(f.lifecycle)),
      edgesFrom: () => [],
      edgesTo: () => [],
      history: () => [],
    },
    changed: {
      subscribe: (fn: (c: Changed) => void) => {
        rings.add(fn);
        return () => rings.delete(fn);
      },
    },
  };
}

const now = () => '2026-09-30T10:00:00.000Z' as Instant;
const source = (w: ReturnType<typeof world>, viewKey = 'karte') =>
  createViewSource({ facts: w.facts, config, viewKey, actor: anna, geo, now, changed: w.changed });

describe('view source', () => {
  it("delivers the features of the view's layer types first as one add, anchored on their position", () => {
    const w = world([tree(1, 7.1), tree(2, 7.2), area(3)]);
    const changes: FeatureChange[] = [];
    source(w).subscribe([-180, -90, 180, 90], (c) => changes.push(c));
    expect(changes).toHaveLength(1);
    const added = changes[0]?.add ?? [];
    expect(added.map((f) => f.id).sort()).toEqual([fid(1), fid(2), fid(3)]);
    expect(added.find((f) => f.id === fid(1))?.anchor).toEqual([7.1, 50.7]);
    // an area's anchor lies on the area (pointOnSurface), not on a vertex mean
    const a = added.find((f) => f.id === fid(3))?.anchor ?? [0, 0];
    expect(a[0]).toBeGreaterThan(7);
    expect(a[0]).toBeLessThan(8);
  });

  it('a view with a filter shows only the features it accepts', () => {
    const w = world([tree(1, 7.1, { zustaendig: 'anna', faellig_am: '2026-01-01' }), tree(2, 7.2)]);
    const got = source(w, 'meine_aufgaben').query([-180, -90, 180, 90]);
    expect(got.map((f) => f.id)).toEqual([fid(1)]);
  });

  it('a change is sent as an update, an addition or a removal, and untouched features are not sent again', () => {
    const w = world([tree(1, 7.1), tree(2, 7.2)]);
    const changes: FeatureChange[] = [];
    source(w).subscribe([-180, -90, 180, 90], (c) => changes.push(c));
    w.set(tree(1, 7.15, { stage: 'kontrolliert' })); // moved and changed: a new state object
    w.set(tree(3, 7.3)); // created (for example by a queued run)
    w.states.delete(fid(2)); // gone
    w.ring();
    expect(changes).toHaveLength(2);
    const c = changes[1];
    expect(c?.update.map((f) => f.id)).toEqual([fid(1)]);
    expect(c?.add.map((f) => f.id)).toEqual([fid(3)]);
    expect(c?.remove).toEqual([fid(2)]);
  });

  it('nothing is sent when nothing changed, and nothing after unsubscribe', () => {
    const w = world([tree(1, 7.1)]);
    const changes: FeatureChange[] = [];
    const off = source(w).subscribe([-180, -90, 180, 90], (c) => changes.push(c));
    w.ring();
    expect(changes).toHaveLength(1);
    off();
    w.set(tree(2, 7.2));
    w.ring();
    expect(changes).toHaveLength(1);
  });

  it('a feature without a position, or a deleted one, is not drawn', () => {
    const w = world([
      { ...tree(1, 7.1), properties: { stage: 'erfasst' } as never },
      { ...tree(2, 7.2), lifecycle: 'deleted' },
    ]);
    expect(source(w).query([-180, -90, 180, 90])).toEqual([]);
  });

  it('a page names its ids: only those features are examined and no view walk happens', () => {
    const w = world([tree(1, 7.1), tree(2, 7.2), tree(3, 7.3)]);
    const changes: FeatureChange[] = [];
    source(w).subscribe([-180, -90, 180, 90], (c) => changes.push(c));
    const walked = w.walks.count;
    w.set(tree(2, 7.25, { stage: 'kontrolliert' })); // changed
    w.set(tree(4, 7.4)); // new
    w.states.delete(fid(3)); // gone
    w.set(tree(5, 7.5, {}));
    w.ring(new Set([fid(2), fid(3), fid(4)])); // feature 5 exists but the page did not name it
    expect(w.walks.count).toBe(walked);
    const c = changes[1];
    expect(c?.update.map((f) => f.id)).toEqual([fid(2)]);
    expect(c?.add.map((f) => f.id)).toEqual([fid(4)]);
    expect(c?.remove).toEqual([fid(3)]);
    // an id-notice keeps what was sent in step: a later full walk reports only what the ids did not cover
    w.ring();
    expect(changes[2]?.add.map((f) => f.id)).toEqual([fid(5)]);
    expect(changes[2]?.update).toEqual([]);
  });

  it('a page whose features are not in the view sends nothing', () => {
    const w = world([tree(1, 7.1)]);
    const changes: FeatureChange[] = [];
    source(w).subscribe([-180, -90, 180, 90], (c) => changes.push(c));
    w.set({ ...area(9), type: 'baumart' as Key }); // a type the view does not draw
    w.ring(new Set([fid(9)]));
    expect(changes).toHaveLength(1);
  });

  it('names the look of each feature by its Objektart and value (WP-744), none for a type without a look', () => {
    const w = world([tree(1, 7.1), tree(2, 7.2, { stage: 'kontrolliert' }), area(3)]);
    const changes: FeatureChange[] = [];
    source(w).subscribe([-180, -90, 180, 90], (c) => changes.push(c));
    const added = changes[0]?.add ?? [];
    const lookKey = (n: number) => added.find((f) => f.id === fid(n))?.properties[LOOK_KEY];
    expect(lookKey(1)).toBe('baum|erfasst');
    expect(lookKey(2)).toBe('baum|kontrolliert');
    expect(lookKey(3)).toBe(config.file.types?.['flaeche']?.marker === undefined ? undefined : 'flaeche');
  });

  it('has looks for every Objektart the view draws, the same the filter sheet resolves', () => {
    const looks = drawnLooks(config, 'karte');
    expect(looks?.property).toBe(LOOK_KEY);
    const baum = config.file.types?.['baum'];
    expect(looks?.values['baum|kontrolliert']).toEqual(
      baum === undefined ? undefined : lookOf(baum, 'kontrolliert'),
    );
    expect(looks?.values['baum|kontrolliert']?.icon).toEqual({ key: 'check' });
  });

  it('has none for a view that does not exist', () => {
    expect(drawnLooks(config, 'gibt-es-nicht')).toBeUndefined();
  });
});

describe('view source: no full scan per interaction (WP-800)', () => {
  it('query reads the store through the box it was asked for, not the whole world', () => {
    const w = world([tree(1, 7.1), tree(2, 7.2)]);
    const box = [7, 50, 7.15, 51] as const;
    expect(
      source(w)
        .query([...box])
        .map((f) => f.id),
    ).toEqual([fid(1)]);
    expect(w.boxes.length).toBeGreaterThan(0);
    expect(w.boxes.every((b) => b?.join() === box.join())).toBe(true);
  });

  it('a change that names its ids does not walk the types of the view', () => {
    const w = world([tree(1, 7.1), tree(2, 7.2)]);
    const changes: FeatureChange[] = [];
    source(w).subscribe([-180, -90, 180, 90], (c) => changes.push(c));
    const before = w.walks.count;
    w.set(tree(3, 7.3));
    w.ring(new Set([fid(3)]));
    expect(w.walks.count).toBe(before);
    expect(changes.at(-1)?.add.map((f) => f.id)).toEqual([fid(3)]);
  });
});
