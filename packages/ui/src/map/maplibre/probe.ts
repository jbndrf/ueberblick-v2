// The e2e read-back seam (WP-745): one attribute on the map element, `data-map-state`, written from what MapLibre holds
// (`map.getMinZoom()`, `getLayoutProperty`, `listImages()`, `queryRenderedFeatures`), never from the app's own state. The
// highlight, the cluster circles and the marker icons are canvas pixels, so a journey on the built app can only prove
// that a feature reached the real map by reading it back here. Written when the map settles (`idle`) and after the
// renderer changes limits, looks or layers; it costs one rendered-features query per settle.
import type { MlMap } from './api';
import { LAYER_IDS } from './layers';

/** What the element carries (JSON in `data-map-state`). */
export interface MapState {
  readonly zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Cluster circles and single markers MapLibre has drawn in view right now. */
  readonly clusters: number;
  readonly singles: number;
  /** The `icon-image` expression of the single-marker layer, and the look images registered on the map. */
  readonly iconImage: unknown;
  readonly images: readonly string[];
  /** The visible extent [west, south, east, north] (the start fit is read back from it, WP-850). */
  readonly bounds: readonly [number, number, number, number];
}

const LOOK_IMAGE = /^ub-look-/;

/** Reads the state off the map. `layers` are the ids the renderer has drawn. */
export function readMapState(m: MlMap, layers: ReadonlySet<string>): MapState {
  const rendered = (id: string): number =>
    layers.has(id)
      ? m.queryRenderedFeatures(
          [
            [0, 0],
            [1e5, 1e5],
          ],
          { layers: [id] },
        ).length
      : 0;
  return {
    zoom: m.getZoom(),
    minZoom: m.getMinZoom(),
    maxZoom: m.getMaxZoom(),
    clusters: rendered(LAYER_IDS.cluster),
    singles: rendered(LAYER_IDS.single),
    // a circle layer (a project without looks) has no icon-image, and MapLibre throws on asking
    iconImage:
      m.getLayer(LAYER_IDS.single)?.type === 'symbol'
        ? m.getLayoutProperty(LAYER_IDS.single, 'icon-image')
        : null,
    images: m.listImages().filter((id) => LOOK_IMAGE.test(id)),
    bounds: ((b) => [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as const)(m.getBounds()),
  };
}

/**
 * The seam exists only in the e2e build (R14: it queries the map on every settle). `apps/web/vite.config.ts` defines
 * `__UB_MAP_PROBE__` as true when `UB_MAP_PROBE=1` is set for the build (`scripts/e2e/run.mjs` sets it); a production
 * build never sets it, so the renderer does not attach the listener at all. Specs pass `probe: true` instead.
 */
declare const __UB_MAP_PROBE__: boolean | undefined;
export const PROBE_BUILD: boolean = typeof __UB_MAP_PROBE__ !== 'undefined' && __UB_MAP_PROBE__ === true;

/** The writer for one map element: a no-op until the map is up (and `undefined` when the seam is off), and where the element cannot hold attributes; it writes only a changed state. */
export function createProbe(
  enabled: boolean | undefined,
  el: HTMLElement,
  map: () => MlMap | undefined,
  layers: ReadonlySet<string>,
): (() => void) | undefined {
  if (!(enabled ?? PROBE_BUILD)) return undefined; // production: no listener, no cost
  let last = '';
  return () => {
    const m = map();
    if (m === undefined) return;
    const json = JSON.stringify(readMapState(m, layers));
    if (json === last) return;
    last = json;
    el.setAttribute?.('data-map-state', json);
  };
}
