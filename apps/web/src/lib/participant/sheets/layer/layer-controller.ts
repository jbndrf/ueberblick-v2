/**
 * The one holder of the map layer choice (v3 `MapCanvas` kept `activeBaseLayerId` and `activeOverlayIds`): the Layer
 * sheet writes it, the map reads it. The layers are those of the person's roles (`layersForRoles`, applied here once,
 * so nothing downstream filters again). What is on is a personal preference (WP-612, `ui.map_layers`,
 * behind `LayerChoiceStore`): it survives a reload and follows the person to another device.
 */
import type { MapConfig } from '@ueberblick/core/model';
import {
  DEFAULT_BASE_LAYER,
  layersForRoles,
  orderedLayerKeys,
  resolveSelection,
  type MapSelection,
} from '@ueberblick/core/registry';
import type { LayerChoiceStore } from './layer-prefs';

/** The layers a participant with these roles may see; none when the project declares no `map`. */
export function participantMap(map: MapConfig | undefined, roles: readonly string[]): MapConfig | undefined {
  return map === undefined ? undefined : layersForRoles(map, roles);
}

/** The base v3 drew when a project configured none (`MapCanvas.svelte:203,357` `default-osm`): the registry's OSM preset. */
const DEFAULT_BASE = DEFAULT_BASE_LAYER.key;

const withOsm = new WeakMap<object, MapConfig>();
const NO_MAP = {};

/** One config object per input, so the renderer sees the same config again and redraws only what changed. */
function withOsmBase(map: MapConfig | undefined): MapConfig {
  const key = map ?? NO_MAP;
  let made = withOsm.get(key);
  if (made === undefined) {
    const osm = {
      label: 'OpenStreetMap',
      kind: 'base',
      source: { type: 'preset', preset: DEFAULT_BASE_LAYER.preset },
    };
    made = {
      ...map,
      layers: { [DEFAULT_BASE]: osm, ...map?.layers },
      order: [DEFAULT_BASE, ...(map === undefined ? [] : orderedLayerKeys(map))],
    } as MapConfig;
    withOsm.set(key, made);
  }
  return made;
}

/**
 * What the map draws: the person's layers, with the OSM base added when there is no base layer to draw. The Layer
 * sheet does not list it (v3 said "no layers configured" and still drew OSM).
 */
export function withDefaultBase(
  map: MapConfig | undefined,
  selection: MapSelection,
): { map: MapConfig; selection: MapSelection } {
  const layers = map?.layers ?? {};
  if (selection.base !== undefined && layers[selection.base] !== undefined)
    return { map: map as MapConfig, selection };
  return { map: withOsmBase(map), selection: { ...selection, base: DEFAULT_BASE } };
}

export interface LayerController {
  /** The layers this person sees; undefined when the project has no map section. */
  map(): MapConfig | undefined;
  /** What is on now: the remembered choice where it still fits, else the start selection. */
  selection(): MapSelection;
  setBase(key: string): void;
  toggleOverlay(key: string, on: boolean): void;
  subscribe(listener: () => void): () => void;
}

export interface LayerControllerDeps {
  readonly map: MapConfig | undefined;
  /** The person's preference record. */
  readonly store: LayerChoiceStore;
}

export function createLayerController({ map, store }: LayerControllerDeps): LayerController {
  const empty: MapSelection = { base: undefined, overlays: [] };
  const fit = (choice: MapSelection | undefined): MapSelection =>
    map === undefined ? empty : resolveSelection(map, choice);
  let current = fit(store.read());
  const listeners = new Set<() => void>();
  const set = (next: MapSelection): void => {
    current = next;
    try {
      store.write(next);
    } catch {
      // the choice then lasts until the app closes; the map still follows it
    }
    for (const l of [...listeners]) l();
  };
  // The record changed under us (a sync brought the choice from another device): follow it.
  store.subscribe(() => {
    const next = fit(store.read());
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    for (const l of [...listeners]) l();
  });
  const has = (key: string, kind: string): boolean => map?.layers[key]?.kind === kind;
  return {
    map: () => map,
    selection: () => current,
    setBase(key) {
      if (has(key, 'base')) set({ ...current, base: key });
    },
    toggleOverlay(key, on) {
      if (!has(key, 'overlay')) return;
      const wanted = new Set(current.overlays);
      if (on) wanted.add(key);
      else wanted.delete(key);
      set(fit({ base: current.base, overlays: [...wanted] }));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
