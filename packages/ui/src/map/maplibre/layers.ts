// Sources and default layers. A layer's `style` from the view (MapLibre Style Spec fragment,
// decision 0014) is applied on top by a follow-up; the defaults keep the map usable without one.

import { FAMILY_OPEN_KEY } from '@ueberblick/core/marker';
import { DEFAULT_MARKER_COLOR } from '@ueberblick/core/registry';
import { LAYER_IDS, SOURCES } from '../view-style';
import { SELECT_RINGS, SELECT_SHAPES } from './selection';

export { LAYER_IDS, SOURCES };

export interface LayerDef {
  readonly source?: { readonly id: string; readonly spec: unknown };
  readonly spec: unknown;
}

const empty = { type: 'FeatureCollection', features: [] };
const isCluster = ['has', 'clusterId'];
/** A single marker whose feature has open children at its position (B-019). */
const hasOpen = ['all', ['!', isCluster], ['>', ['coalesce', ['get', FAMILY_OPEN_KEY], 0], 0]];
/** The badge sits on the marker's upper right (px), like a notification dot. */
const BADGE_AT = [11, -13];

export const LAYERS: readonly LayerDef[] = [
  {
    source: { id: SOURCES.geometry, spec: { type: 'geojson', data: empty, promoteId: 'id' } },
    spec: {
      id: LAYER_IDS.fill,
      type: 'fill',
      source: SOURCES.geometry,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': DEFAULT_MARKER_COLOR, 'fill-opacity': 0.3 },
    },
  },
  {
    spec: {
      id: LAYER_IDS.line,
      type: 'line',
      source: SOURCES.geometry,
      paint: { 'line-color': DEFAULT_MARKER_COLOR, 'line-width': 3 },
    },
  },
  ...SELECT_SHAPES,
  ...SELECT_RINGS, // behind the single markers and the cluster circles, as v3 (`MapCanvas.svelte:1052`)
  {
    source: { id: SOURCES.clusters, spec: { type: 'geojson', data: empty } },
    spec: {
      id: LAYER_IDS.cluster,
      type: 'circle',
      source: SOURCES.clusters,
      filter: isCluster,
      paint: {
        'circle-color': '#1a365d',
        'circle-radius': 18,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    },
  },
  {
    spec: {
      id: LAYER_IDS.count,
      type: 'symbol',
      source: SOURCES.clusters,
      filter: isCluster,
      layout: { 'text-field': ['get', 'count'], 'text-size': 14 },
      paint: { 'text-color': '#fff' },
    },
  },
  {
    spec: {
      id: LAYER_IDS.single,
      type: 'circle',
      source: SOURCES.clusters,
      filter: ['!', isCluster],
      paint: {
        'circle-color': DEFAULT_MARKER_COLOR,
        'circle-radius': 9,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    },
  },
  {
    spec: {
      id: LAYER_IDS.open,
      type: 'circle',
      source: SOURCES.clusters,
      filter: hasOpen,
      paint: {
        'circle-color': '#d97706',
        'circle-radius': 8,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.5,
        'circle-translate': BADGE_AT,
      },
    },
  },
  {
    spec: {
      id: LAYER_IDS.openCount,
      type: 'symbol',
      source: SOURCES.clusters,
      filter: hasOpen,
      layout: {
        'text-field': ['to-string', ['get', FAMILY_OPEN_KEY]],
        'text-size': 11,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#fff', 'text-translate': BADGE_AT },
    },
  },
];

/** A style with no tiles: works offline (tile packs are out of scope). */
export function baseStyle(): unknown {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f1efe9' } }],
  };
}
