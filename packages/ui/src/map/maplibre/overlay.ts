// Tool overlays (measure lines and areas, draw preview, search highlight): one GeoJSON source and three
// layers above everything the view draws. Overlays are few and small, so a change re-sends them all; the
// features in view are never touched (B-008). Colours come from the caller's design tokens, never from here.
import type { Geometry } from '@ueberblick/core/geo';
import type { OverlayStyle } from '../contract';
import type { GeoJsonFeature, MlMap } from './api';
import { accuracyRadii, accuracyLayer } from './accuracy';

const SOURCE = 'ub-overlay';
const LAYER_FILL = 'ub-overlay-fill';
const LAYER_ACCURACY = 'ub-overlay-accuracy';
const LAYER_LINE = 'ub-overlay-line';
const LAYER_DASH = 'ub-overlay-dash';
const LAYER_POINT = 'ub-overlay-point';
const LAYERS = [LAYER_FILL, LAYER_ACCURACY, LAYER_LINE, LAYER_DASH, LAYER_POINT] as const;
const DEFAULT_WIDTH = 4;
const DASH = [2.5, 2.5]; // v3's placement connector: units of the line width

function feature(id: string, geometry: Geometry, style: OverlayStyle): GeoJsonFeature {
  return {
    type: 'Feature',
    properties: {
      id,
      color: style.color,
      fillColor: style.fillColor ?? style.color,
      width: style.width ?? DEFAULT_WIDTH,
      opacity: style.opacity ?? 1,
      dashed: style.dashed === true,
      ...(style.accuracy !== undefined && geometry.type === 'Point'
        ? accuracyRadii(style.accuracy, geometry.coordinates[1] as number)
        : {}),
    },
    geometry,
  };
}

export interface OverlayLayer {
  show(id: string, geometry: Geometry, style: OverlayStyle): void;
  clear(id: string): void;
  /** Adds the source and layers to a loaded map, with what was shown before it loaded. */
  attach(map: MlMap): void;
  /** After a view's layers were redrawn: puts the overlay back on top. Does not re-send data. */
  raise(): void;
  /** Removes the source and layers from the map. */
  dispose(): void;
}

export function createOverlayLayer(): OverlayLayer {
  const shown = new Map<string, GeoJsonFeature>();
  let map: MlMap | undefined;

  const push = (): void => {
    map?.getSource(SOURCE)?.setData({ type: 'FeatureCollection', features: [...shown.values()] });
  };

  return {
    show(id, geometry, style) {
      shown.set(id, feature(id, geometry, style));
      push();
    },
    clear(id) {
      if (shown.delete(id)) push();
    },
    attach(m) {
      map = m;
      m.addSource(SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [...shown.values()] },
      });
      m.addLayer({
        id: LAYER_FILL,
        type: 'fill',
        source: SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': 0.25 },
      });
      m.addLayer(accuracyLayer(LAYER_ACCURACY, SOURCE)); // under the dot, as v3's user-location
      m.addLayer({
        id: LAYER_LINE,
        type: 'line',
        source: SOURCE,
        filter: ['all', ['!=', ['geometry-type'], 'Point'], ['!', ['get', 'dashed']]],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
        },
      });
      // a dash pattern is not data-driven in MapLibre: dashed lines get their own layer (v3's placement connector)
      m.addLayer({
        id: LAYER_DASH,
        type: 'line',
        source: SOURCE,
        filter: ['all', ['!=', ['geometry-type'], 'Point'], ['get', 'dashed']],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
          'line-dasharray': DASH,
        },
      });
      m.addLayer({
        id: LAYER_POINT,
        type: 'circle',
        source: SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['+', ['get', 'width'], 3],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
    },
    raise() {
      if (map === undefined) return;
      for (const id of LAYERS) map.moveLayer(id);
    },
    dispose() {
      if (map === undefined) return;
      for (const id of LAYERS) map.removeLayer(id);
      map.removeSource(SOURCE);
      map = undefined;
    },
  };
}
