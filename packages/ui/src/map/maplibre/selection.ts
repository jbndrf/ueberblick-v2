// The selected-feature highlight (WP-733, v3 `MapCanvas.svelte:189,980-993,1052-1066` and
// `instance-geometry-layer.svelte:138-149,219-225`): a ring around the selected point, a heavier stroke and a fuller
// fill on the selected line or area, while its sheet is open. v3 set a feature-state on one feature; the layers here
// carry a filter on the selected id instead (the cluster source is re-set on every query and has no stable ids), so
// selecting and deselecting is `setFilter` on four layers: O(1), the source data is never rewritten.
import type { FeatureId } from '@ueberblick/core/model';
import type { Selection } from '../contract';
import type { LayerDef } from './layers';
import type { MlMap } from './api';
import { SOURCES } from '../view-style';

/** Ids of the highlight layers. They are drawn by the renderer, never tappable and never replaced by a view style. */
export const SELECT_IDS = {
  fill: 'ub-select-fill',
  line: 'ub-select-line',
  halo: 'ub-select-halo',
  ring: 'ub-select-ring',
} as const;

const SELECT_LAYER_IDS: readonly string[] = Object.values(SELECT_IDS);
export const isSelectionLayer = (id: string): boolean => SELECT_LAYER_IDS.includes(id);

const NONE = ['==', ['get', 'id'], ''];
const NONE_POINT = ['==', ['get', 'featureId'], ''];
const IS_POLYGON = ['==', ['geometry-type'], 'Polygon'];
const NOT_CLUSTER = ['!', ['has', 'clusterId']];
/** v3 `rasterizeRing`: a 3 px ring at 70 % and, 3 px further out, one at 20 % around the marker's body (radius 9). */
const RING_RADIUS = 11;
const HALO_RADIUS = 14;
const IDLE = '#2563eb';

const point = (id: string, radius: number, opacity: number): LayerDef => ({
  spec: {
    id,
    type: 'circle',
    source: SOURCES.clusters,
    filter: ['all', NOT_CLUSTER, NONE_POINT],
    paint: {
      'circle-radius': radius,
      'circle-opacity': 0,
      'circle-stroke-width': 3,
      'circle-stroke-color': IDLE,
      'circle-stroke-opacity': opacity,
      'circle-pitch-alignment': 'map',
    },
  },
});

/** Shapes: the fill and line sit directly above the view's shape layers; the rings sit just behind the single markers. */
export const SELECT_SHAPES: readonly LayerDef[] = [
  {
    spec: {
      id: SELECT_IDS.fill,
      type: 'fill',
      source: SOURCES.geometry,
      filter: ['all', IS_POLYGON, NONE],
      paint: { 'fill-color': IDLE, 'fill-opacity': 0.15 },
    },
  },
  {
    spec: {
      id: SELECT_IDS.line,
      type: 'line',
      source: SOURCES.geometry,
      filter: NONE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      // v3 `instance-geometry-layer.svelte:149`: the selected stroke is 4 px on an area and 6 px on a line.
      paint: { 'line-color': IDLE, 'line-width': ['case', IS_POLYGON, 4, 6] },
    },
  },
];
export const SELECT_RINGS: readonly LayerDef[] = [
  point(SELECT_IDS.halo, HALO_RADIUS, 0.2),
  point(SELECT_IDS.ring, RING_RADIUS, 0.7),
];

/** The filters for a selected id: a layer shows the one feature it matches and nothing otherwise. */
export function selectionFilters(id: FeatureId | null): Readonly<Record<string, unknown>> {
  const shape = id === null ? NONE : ['==', ['get', 'id'], id];
  const dot = id === null ? NONE_POINT : ['==', ['get', 'featureId'], id];
  return {
    [SELECT_IDS.fill]: ['all', IS_POLYGON, shape],
    [SELECT_IDS.line]: shape,
    [SELECT_IDS.halo]: ['all', NOT_CLUSTER, dot],
    [SELECT_IDS.ring]: ['all', NOT_CLUSTER, dot],
  };
}

const PAINT: readonly (readonly [string, string])[] = [
  [SELECT_IDS.fill, 'fill-color'],
  [SELECT_IDS.line, 'line-color'],
  [SELECT_IDS.halo, 'circle-stroke-color'],
  [SELECT_IDS.ring, 'circle-stroke-color'],
];

export interface SelectionLayer {
  set(next: Selection | null): void;
  /** Puts the held selection on a map whose layers were just drawn (a style change redraws them). */
  apply(map: MlMap): void;
}

/** Holds the one selection; `set` touches the map only when it is loaded, `apply` brings a fresh set of layers up to date. */
export function createSelectionLayer(
  map: () => MlMap | undefined,
  loaded: () => boolean,
  /** Told after the filters are on the map (the e2e seam reads back what MapLibre holds). */
  applied: (m: MlMap) => void = () => undefined,
): SelectionLayer {
  let held: Selection | null = null;
  const apply = (m: MlMap): void => {
    for (const [layer, filter] of Object.entries(selectionFilters(held?.id ?? null)))
      m.setFilter(layer, filter);
    if (held !== null) for (const [layer, prop] of PAINT) m.setPaintProperty(layer, prop, held.color);
    applied(m);
  };
  return {
    set(next) {
      if (next?.id === held?.id && next?.color === held?.color) return;
      held = next;
      const m = map();
      if (m !== undefined && loaded()) apply(m);
    },
    apply,
  };
}
