// The filter wiring (WP-648): the map really filters by an active view, a role preset or a saved filter of the person's
// record, through core/filters and the device's permissions, and the switches are ignored meanwhile.
import { describe, expect, it } from 'vitest';
import type { FeatureAccess } from '@ueberblick/core/expr';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { actorValue } from '@ueberblick/core/perms';
import type { SavedFilter } from '@ueberblick/core/prefs';
import { goldenConfig } from '@ueberblick/core/testing';
import type { FeatureSource, MapFeature } from '@ueberblick/ui';
import { createFilterController } from '../sheets/filter/filter-controller';
import { filteredSource } from '../sheets/filter/filtered-source';
import { deviceViewPassOf } from '../sheets/filter/view-pass';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const actor = { id: 'u1', kind: 'participant' as const, roles: ['kontrolle' as Key] };
const state = (id: string, stage: string): FeatureState =>
  ({
    id,
    type: 'baum',
    properties: { stage },
    lifecycle: 'active',
    updatedSeq: 1,
  }) as unknown as FeatureState;
const states = new Map([
  ['1', state('1', 'erfasst')],
  ['2', state('2', 'erledigt')],
]);
const features: FeatureAccess = {
  property: (id, key) => states.get(id)?.properties[key],
  related: () => [],
  history: () => [],
  type: (id) => states.get(id)?.type,
};
const device = {
  get classified() {
    return (this as { config: never }).config;
  },
  config,
  actor,
  roleKey: 'kontrolle',
  reader: {
    taskContext: () => ({
      vars: new Map([['actor', actorValue(actor)]]),
      features,
      now: '2026-10-01T08:00:00.000Z',
      relations: new Map(),
      geo: createGeo(),
    }),
  },
} as unknown as Parameters<typeof deviceViewPassOf>[0];
const mf = (id: string): MapFeature =>
  ({
    id: id as FeatureId,
    anchor: [0, 0],
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {},
  }) as MapFeature;
const source: FeatureSource = {
  query: () => [...states.keys()].map(mf),
  *queryChunks() {
    yield [...states.keys()].map(mf);
  },
  subscribe: () => () => undefined,
};

function map(saved: readonly SavedFilter[]) {
  const filter = createFilterController();
  const shown = filteredSource(
    source,
    (id) => states.get(id),
    config,
    filter,
    deviceViewPassOf(device, () => saved),
  );
  const ids = () => shown.query([-180, -90, 180, 90]).map((f) => f.id as string);
  return { filter, ids };
}

describe('the map filters by an active view', () => {
  const saved: SavedFilter[] = [{ id: 's1', name: 'Erfasst', filters: { baum: "self.stage == 'erfasst'" } }];

  it('a saved filter of the person shows only the features that pass, and Standard shows all again', () => {
    const { filter, ids } = map(saved);
    expect(ids()).toEqual(['1', '2']);
    filter.setActiveView({ kind: 'saved', key: 's1' });
    expect(ids()).toEqual(['1']);
    filter.setActiveView(null);
    expect(ids()).toEqual(['1', '2']);
  });

  it('the switches are ignored while the view is active', () => {
    const { filter, ids } = map(saved);
    filter.setType('baum' as Key, false);
    expect(ids()).toEqual([]);
    filter.setActiveView({ kind: 'saved', key: 's1' });
    expect(ids()).toEqual(['1']);
  });

  it('a saved filter that was deleted lets the switches decide', () => {
    const { filter, ids } = map([]);
    filter.setActiveView({ kind: 'saved', key: 'gone' });
    expect(ids()).toEqual(['1', '2']);
  });
});
