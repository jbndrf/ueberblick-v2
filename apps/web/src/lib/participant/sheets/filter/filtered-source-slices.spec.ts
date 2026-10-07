import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import type { FeatureChange, FeatureSource, MapFeature } from '@ueberblick/ui';
import { filteredSource } from './filtered-source';
import { createFilterController } from './filter-controller';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const WORLD = [-180, -90, 180, 90] as const;
const N = 9500; // more than two slices
const typeOf = (i: number): string => (i % 2 === 0 ? 'baum' : 'flaeche');
const states = new Map<string, FeatureState>();
const features: MapFeature[] = [];
for (let i = 0; i < N; i++) {
  const id = `f${i}`;
  states.set(id, { id, type: typeOf(i), properties: {}, lifecycle: 'active' } as unknown as FeatureState);
  features.push({
    id: id as FeatureId,
    anchor: [0, 0],
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {},
  } as MapFeature);
}
let sliceSizes: number[] = [];
const source: FeatureSource = {
  query: () => features,
  *queryChunks(_bbox, size = 4000) {
    for (let at = 0; at < features.length; at += size) {
      sliceSizes.push(Math.min(size, features.length - at));
      yield features.slice(at, at + size);
    }
  },
  subscribe: (_b, l) => {
    l({ add: features, update: [], remove: [] });
    return () => undefined;
  },
};
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

function mount() {
  const controller = createFilterController();
  const wrapped = filteredSource(source, (id) => states.get(id), config, controller);
  const shown = new Set<string>();
  const events: FeatureChange[] = [];
  const stop = wrapped.subscribe([...WORLD], (c) => {
    events.push(c);
    for (const f of c.add) shown.add(f.id);
    for (const id of c.remove) shown.delete(id);
  });
  return { controller, wrapped, shown, events, stop };
}

describe('filteredSource reapply in slices (WP-848)', () => {
  it('ends with the same visible set as the whole walk, one event per slice', async () => {
    const { controller, wrapped, shown, events } = mount();
    expect(shown.size).toBe(N);
    events.length = 0;
    controller.setType('baum' as Key, false);
    await settle();
    const expected = wrapped.query([...WORLD]).map((f) => f.id);
    expect([...shown].sort()).toEqual([...expected].sort());
    expect(shown.size).toBe(N / 2);
    expect(events.length).toBeGreaterThan(1); // removals of 4750 features: two slices
    controller.setType('baum' as Key, true);
    await settle();
    expect(shown.size).toBe(N);
    expect(events.every((e) => e.add.length + e.remove.length <= 4000)).toBe(true);
  });

  it('queryChunks of the filtered source gives the same features as query', () => {
    const { controller, wrapped } = mount();
    controller.setType('flaeche' as Key, false);
    sliceSizes = [];
    const chunked = [...wrapped.queryChunks([...WORLD], 4000)].flat().map((f) => f.id);
    expect(chunked).toEqual(wrapped.query([...WORLD]).map((f) => f.id));
    expect(sliceSizes).toEqual([4000, 4000, 1500]);
  });

  it('a newer filter change ends the older walk', async () => {
    const { controller, shown } = mount();
    controller.setType('baum' as Key, false);
    controller.setType('baum' as Key, true); // before the first walk reached its second slice
    await settle();
    expect(shown.size).toBe(N);
    expect([...shown].every((id) => states.has(id))).toBe(true);
  });

  it('unsubscribe ends a walk in progress', async () => {
    const { controller, shown, stop } = mount();
    controller.setType('baum' as Key, false);
    const after = shown.size;
    stop();
    await settle();
    expect(shown.size).toBe(after);
    expect(after).toBeGreaterThan(N / 2); // only the first slice ran
  });
});
