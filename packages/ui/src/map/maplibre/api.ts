import type { RenderedHit } from './tap';
// The slice of MapLibre GL the adapter uses. Keeping it this small lets tests fake the library
// and keeps every MapLibre-specific name inside `map/maplibre/`.

export interface GeoJsonFeature {
  readonly type: 'Feature';
  readonly id?: string;
  readonly properties: { readonly [key: string]: unknown };
  readonly geometry: unknown;
}

export interface GeoJsonDiff {
  readonly add?: readonly GeoJsonFeature[];
  readonly update?: readonly {
    readonly id: string;
    readonly newGeometry?: unknown;
    readonly removeAllProperties?: boolean;
    readonly addOrUpdateProperties?: readonly { key: string; value: unknown }[];
  }[];
  readonly remove?: readonly string[];
}

export interface MlSource {
  setData(data: { readonly type: 'FeatureCollection'; readonly features: readonly GeoJsonFeature[] }): void;
  updateData(diff: GeoJsonDiff): Promise<void> | void;
}

/** A click on the map itself (not delegated to a layer): where, in WGS84 and on screen. */
export interface MlMapClick {
  readonly lngLat: { readonly lng: number; readonly lat: number };
  readonly point: { readonly x: number; readonly y: number };
}

export interface MlBounds {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

/** A DOM marker of MapLibre: `draggable` is set at construction; `drag` fires on every move, `dragend` once. */
export interface MlMarker {
  setLngLat(at: [number, number]): MlMarker;
  getLngLat(): { readonly lng: number; readonly lat: number };
  addTo(map: MlMap): MlMarker;
  /** Returns a subscription in MapLibre, not the marker: callers must not chain. */
  on(type: 'drag' | 'dragend', listener: () => void): unknown;
  remove(): MlMarker;
}

export interface MlMap {
  addSource(id: string, spec: unknown): void;
  addLayer(spec: unknown): void;
  removeLayer(id: string): void;
  /** Registers a raster image for `icon-image` (v3 `map-icons.ts`); `pixelRatio` 2 draws a 2x image at half its size. */
  addImage(id: string, image: unknown, options?: { pixelRatio?: number }): void;
  hasImage(id: string): boolean;
  removeImage(id: string): void;
  getSource(id: string): MlSource | undefined;
  on(type: 'load' | 'moveend' | 'move' | 'idle', listener: () => void): void;
  /** `originalEvent` is set when a person (drag, wheel, pinch) starts the move, not code. */
  on(type: 'movestart', listener: (e: { readonly originalEvent?: unknown }) => void): void;
  off(type: 'move', listener: () => void): void;
  /** WGS84 to px in the map's container, and back. */
  project(at: [number, number]): { readonly x: number; readonly y: number };
  unproject(point: [number, number]): { readonly lng: number; readonly lat: number };
  on(type: 'click', listener: (e: MlMapClick) => void): void;
  off(type: 'click', listener: (e: MlMapClick) => void): void;
  /** The features drawn at a screen point, limited to the given layers. */
  queryRenderedFeatures(
    area: { x: number; y: number } | [[number, number], [number, number]],
    options: { layers: string[] },
  ): readonly RenderedHit[];
  moveLayer(id: string, beforeId?: string): void;
  /** Changes a layer's filter (an expression); the source data is untouched. */
  setFilter(layerId: string, filter: unknown): void;
  /** The filter a layer has now (what MapLibre holds, not what was asked for). */
  getFilter(layerId: string): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  /** The pointer entering or leaving a feature of one layer (desktop only: a touch has no hover). */
  on(type: 'mouseenter' | 'mouseleave', layerId: string, listener: () => void): void;
  /** The map's canvas: its `style.cursor` is the pointer. */
  getCanvas(): { readonly style: { cursor: string } };
  removeSource(id: string): void;
  fitBounds(
    bounds: [[number, number], [number, number]],
    options: { duration?: number; maxZoom?: number; padding?: number },
  ): void;
  getBounds(): MlBounds;
  getZoom(): number;
  getMinZoom(): number;
  getMaxZoom(): number;
  /** The layer as MapLibre holds it (its `type`), or undefined. */
  getLayer(layerId: string): { readonly type: string } | undefined;
  /** A layout property of a layer as MapLibre holds it (the e2e read-back). */
  getLayoutProperty(layerId: string, name: string): unknown;
  /** The ids of the images on the map. */
  listImages(): string[];
  /** The zoom limits (`null` resets to MapLibre's default). */
  setMinZoom(zoom: number | null): void;
  setMaxZoom(zoom: number | null): void;
  getCenter(): { readonly lng: number; readonly lat: number };
  easeTo(options: {
    center?: [number, number];
    zoom?: number;
    bearing?: number;
    pitch?: number;
    duration?: number;
    /** Pixels the target is moved from the middle of the map ([x, y]). */
    offset?: [number, number];
  }): void;
  /** Pinch and two-finger rotation: v3's map zooms by pinch and never rotates. */
  readonly touchZoomRotate?: { disableRotation(): void };
  /** Double-click and double-tap zoom. */
  readonly doubleClickZoom: { enable(): void; disable(): void };
  remove(): void;
}

export interface MaplibreApi {
  /** Registers a tile protocol (`pmtiles`); a global of the library, so a protocol is registered once. */
  addProtocol?(name: string, handler: unknown): void;
  Marker: new (options: { element: HTMLElement; draggable?: boolean; anchor?: 'center' }) => MlMarker;
  Map: new (options: {
    container: HTMLElement;
    style: unknown;
    center: [number, number];
    zoom: number;
    bearing?: number;
    pitch?: number;
    /** v3 map options (`MapCanvas.svelte:1024-1030`): no rotation, no tilt. */
    dragRotate?: boolean;
    pitchWithRotate?: boolean;
    touchPitch?: boolean;
    /** Pixels a pointer may move and still count as a tap. */
    clickTolerance?: number;
    /** The credit line of the tile sources; v3 shows it compact. */
    attributionControl?: { compact: boolean };
  }) => MlMap;
}

/** Loads MapLibre on demand: the only place the library is imported. */
export async function loadMaplibre(): Promise<MaplibreApi> {
  const mod = await import('maplibre-gl');
  return mod as unknown as MaplibreApi;
}
