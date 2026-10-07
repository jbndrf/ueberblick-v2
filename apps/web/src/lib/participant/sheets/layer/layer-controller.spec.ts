// WP-621: which map layers a person sees (their roles), what is on at the start, and the choice they keep.
import { describe, expect, it, vi } from 'vitest';
import type { MapConfig } from '@ueberblick/core/model';
import { DEFAULT_BASE_LAYER, MAP_PRESETS } from '@ueberblick/core/registry';
import { createPrefsClient, type PrefsTransport } from '@ueberblick/client';
import type { PrefStore } from '@ueberblick/core/prefs';
import { prefsLayerChoice, type LayerChoiceStore } from './layer-prefs';
import { memoryChoice } from './layer-prefs.testing';
import { createLayerController, participantMap, withDefaultBase } from './layer-controller';

const map = {
  layers: {
    osm: { label: 'Straße', kind: 'base', source: { type: 'preset', preset: 'osm' }, on_at_start: true },
    luft: { label: 'Luftbild', kind: 'base', source: { type: 'xyz', url: 'https://t/{z}/{x}/{y}.jpg' } },
    intern: {
      label: 'Intern',
      kind: 'overlay',
      roles: ['kontrolle'],
      on_at_start: true,
      source: { type: 'geojson', url: '/i.geojson' },
    },
    flur: { label: 'Flur', kind: 'overlay', source: { type: 'geojson', url: '/f.geojson' } },
  },
} as unknown as MapConfig;

const make = (roles: readonly string[], store: LayerChoiceStore = memoryChoice()) =>
  createLayerController({ map: participantMap(map, roles), store });

/** One server record and any number of devices on it: each device has its own cache and the shared transport. */
function server() {
  let entries: PrefStore = {};
  const transport: PrefsTransport = {
    fetch: () => Promise.resolve({ entries }),
    send: (sent) => {
      for (const e of sent)
        if ((entries[e.path]?.at ?? '') <= e.at)
          entries = { ...entries, [e.path]: { value: e.value, at: e.at } };
      return Promise.resolve({ entries });
    },
  };
  let tick = 0;
  const device = (participant: string) => {
    const cache = new Map<string, string>();
    return createPrefsClient({
      storage: {
        get: (k) => cache.get(k) ?? null,
        set: (k, v) => void cache.set(k, v),
        remove: (k) => void cache.delete(k),
      },
      transport,
      clock: { now: () => new Date(Date.UTC(2026, 9, 1, 8, 0, 0, ++tick * 10)).toISOString() as never },
      project: 'p1',
      participant,
    });
  };
  return { device };
}

describe('participantMap (roles)', () => {
  it('keeps layers without roles and those that name one of the roles', () => {
    expect(Object.keys(participantMap(map, ['bürger'])?.layers ?? {})).toEqual(['osm', 'luft', 'flur']);
    expect(Object.keys(participantMap(map, ['kontrolle'])?.layers ?? {})).toEqual([
      'osm',
      'luft',
      'intern',
      'flur',
    ]);
  });

  it('is undefined for a project without a map section', () => {
    expect(participantMap(undefined, ['x'])).toBeUndefined();
  });
});

const DEFAULT_BASE = DEFAULT_BASE_LAYER.key;

describe('withDefaultBase (v3 drew OpenStreetMap when no base layer was configured)', () => {
  it('adds the OSM base for a project without a map section, selected', () => {
    const drawn = withDefaultBase(undefined, { base: undefined, overlays: [] });
    expect(Object.keys(drawn.map.layers)).toEqual([DEFAULT_BASE]);
    expect(drawn.map.layers[DEFAULT_BASE]?.source).toEqual({ type: 'preset', preset: 'osm' });
    expect(drawn.selection).toEqual({ base: DEFAULT_BASE, overlays: [] });
  });

  it('credits OSM through the preset only: the default layer carries no attribution of its own, and a project with a base has no default layer to credit', () => {
    const drawn = withDefaultBase(undefined, { base: undefined, overlays: [] });
    expect(drawn.map.layers[DEFAULT_BASE]).not.toHaveProperty('attribution');
    expect(MAP_PRESETS.get(DEFAULT_BASE_LAYER.preset).attribution).toContain('OpenStreetMap');
    const own = withDefaultBase(map, { base: 'osm', overlays: [] });
    expect(own.map.layers[DEFAULT_BASE]).toBeUndefined();
  });

  it('keeps the overlays and adds the OSM base below them when only overlays are configured', () => {
    const only = { layers: { flur: map.layers['flur'] } } as unknown as MapConfig;
    const sel = { base: undefined, overlays: ['flur'] };
    const drawn = withDefaultBase(only, sel);
    expect(drawn.map.order?.[0] ?? Object.keys(drawn.map.layers)[0]).toBe(DEFAULT_BASE);
    expect(drawn.selection).toEqual({ base: DEFAULT_BASE, overlays: ['flur'] });
  });

  it('leaves a project with a base layer alone', () => {
    const sel = { base: 'osm', overlays: [] };
    expect(withDefaultBase(map, sel)).toEqual({ map, selection: sel });
  });
});

describe('layer controller', () => {
  it('starts with the start selection of the layers the person may see', () => {
    expect(make(['bürger']).selection()).toEqual({ base: 'osm', overlays: [] });
    expect(make(['kontrolle']).selection()).toEqual({ base: 'osm', overlays: ['intern'] });
  });

  it('switching the base swaps it; overlays toggle; listeners hear each change', () => {
    const c = make(['kontrolle']);
    const heard = vi.fn();
    c.subscribe(heard);
    c.setBase('luft');
    c.toggleOverlay('flur', true);
    c.toggleOverlay('intern', false);
    expect(c.selection()).toEqual({ base: 'luft', overlays: ['flur'] });
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('refuses a layer the person may not see or that does not exist', () => {
    const c = make(['bürger']);
    c.toggleOverlay('intern', true);
    c.setBase('gibtsnicht');
    expect(c.selection()).toEqual({ base: 'osm', overlays: [] });
  });

  it('the choice is a personal preference: it survives a reload and follows the person to another device', async () => {
    const srv = server();
    const phone = srv.device('u1');
    const first = make(['kontrolle'], prefsLayerChoice(phone));
    first.setBase('luft');
    first.toggleOverlay('intern', false);
    first.toggleOverlay('flur', true);
    expect(phone.current().ui.map_layers).toEqual({ base: 'luft', overlays: ['flur'] });
    expect(make(['kontrolle'], prefsLayerChoice(phone)).selection()).toEqual({
      base: 'luft',
      overlays: ['flur'],
    });
    await phone.sync();

    const tablet = srv.device('u1'); // same person, other device: nothing cached yet
    const there = make(['kontrolle'], prefsLayerChoice(tablet));
    expect(there.selection()).toEqual({ base: 'osm', overlays: ['intern'] });
    const heard = vi.fn();
    there.subscribe(heard);
    await tablet.sync();
    expect(there.selection()).toEqual({ base: 'luft', overlays: ['flur'] });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('is written to the record under ui.map_layers', () => {
    const phone = server().device('u1');
    make(['bürger'], prefsLayerChoice(phone)).setBase('luft');
    expect(phone.entries()['ui.map_layers']?.value).toEqual({ base: 'luft', overlays: [] });
  });

  it('a remembered layer that is gone falls back to the start selection for the base', () => {
    expect(make(['bürger'], memoryChoice({ base: 'weg', overlays: ['weg', 'flur'] })).selection()).toEqual({
      base: 'osm',
      overlays: ['flur'],
    });
  });

  it('a store that refuses a write never breaks the map', () => {
    const refusing: LayerChoiceStore = {
      read: () => undefined,
      write: () => {
        throw new Error('refused');
      },
      subscribe: () => () => undefined,
    };
    const c = make(['bürger'], refusing);
    c.setBase('luft');
    expect(c.selection().base).toBe('luft');
  });

  it('has nothing to show without a map section', () => {
    const c = createLayerController({ map: undefined, store: memoryChoice() });
    expect(c.map()).toBeUndefined();
    expect(c.selection()).toEqual({ base: undefined, overlays: [] });
  });
});
