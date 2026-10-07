// Shared by the renderer specs: a fake MapLibre that records calls, and a mount helper.
import type { View } from '@ueberblick/core/model';
import { createInProcessTransport } from '../cluster/client';
import type { ClusterTransport, ToWorker } from '../cluster/protocol';
import { feature, pointFeature, testSource } from '../test-helpers';
import type { GeoJsonDiff, MaplibreApi, MlMap, MlMapClick, MlSource } from './api';
import type { RenderedHit } from './tap';
import { createMaplibreRenderer, type MaplibreRendererOptions } from './renderer';

export interface Calls {
  updateData: { source: string; diff: GeoJsonDiff }[];
  setData: { source: string; features: readonly { properties: Record<string, unknown> }[] }[];
  layers: string[];
  layerSpecs: unknown[];
  removedLayers: string[];
  /** Ids of the images registered with `addImage`, in order, and the pixel ratio each got. */
  images: { id: string; pixelRatio: number | undefined }[];
  handlers: Map<string, () => void>;
  eased: unknown[];
  fitted: unknown[];
  /** Every `setMinZoom` / `setMaxZoom` call, in order (`null` resets to MapLibre's default). */
  minZoom: (number | null)[];
  maxZoom: (number | null)[];
  moved: string[];
  /** Every `doubleClickZoom.enable()` (true) and `.disable()` (false), in order. */
  doubleClick: boolean[];
  sources: Set<string>;
  removedSources: string[];
  /** What `queryRenderedFeatures` reports under a tap, topmost first (only the layers asked for are returned). */
  rendered: RenderedHit[];
  /** The pixel box of the last `queryRenderedFeatures` and how many queries ran. */
  queries: { box: unknown; layers: string[] }[];
  mapClick: ((e: MlMapClick) => void) | undefined;
  removed: boolean;
  /** Plays a drag of the (one) live marker to a position: `drag` listeners fire. */
  dragMarker: (to: [number, number]) => void;
  /** Every `setFilter` and `setPaintProperty`, in order. */
  filters: { layer: string; filter: unknown }[];
  paints: { layer: string; name: string; value: unknown }[];
  /** The canvas cursor, and the layer-bound hover listeners by `type:layer`. */
  cursor: { cursor: string };
  hovers: Map<string, () => void>;
  /** The options the map was constructed with. */
  options: Record<string, unknown> | undefined;
}

export function fakeMaplibre(): { api: MaplibreApi; calls: Calls } {
  const calls: Calls = {
    updateData: [],
    setData: [],
    layers: [],
    layerSpecs: [],
    removedLayers: [],
    images: [],
    handlers: new Map(),
    eased: [],
    fitted: [],
    minZoom: [],
    maxZoom: [],
    moved: [],
    doubleClick: [],
    sources: new Set(),
    removedSources: [],
    rendered: [],
    queries: [],
    mapClick: undefined,
    removed: false,
    options: undefined,
    filters: [],
    paints: [],
    cursor: { cursor: '' },
    hovers: new Map(),
    dragMarker: () => undefined,
  };
  const sources = new Map<string, MlSource>();
  class FakeMap implements MlMap {
    constructor(options: Record<string, unknown>) {
      calls.options = options;
      queueMicrotask(() => calls.handlers.get('load')?.());
    }
    addSource(id: string): void {
      calls.sources.add(id);
      sources.set(id, {
        setData: (d) => calls.setData.push({ source: id, features: d.features as never }),
        updateData: (diff) => {
          calls.updateData.push({ source: id, diff });
        },
      });
    }
    addLayer(spec: unknown): void {
      const src = (spec as { source?: string }).source; // MapLibre refuses a layer whose source is not there
      if (src !== undefined && !sources.has(src))
        throw new Error(`layers.${(spec as { id: string }).id}: source "${src}" not found`);
      calls.layers.push((spec as { id: string }).id);
      calls.layerSpecs.push(spec);
    }
    addImage(id: string, _image: unknown, options?: { pixelRatio?: number }): void {
      calls.images.push({ id, pixelRatio: options?.pixelRatio });
    }
    hasImage(id: string): boolean {
      return calls.images.some((i) => i.id === id);
    }
    removeImage(id: string): void {
      calls.images = calls.images.filter((i) => i.id !== id);
    }
    setFilter(layer: string, filter: unknown): void {
      calls.filters.push({ layer, filter });
    }
    getFilter(layer: string): unknown {
      return calls.filters.filter((f) => f.layer === layer).at(-1)?.filter;
    }
    setPaintProperty(layer: string, name: string, value: unknown): void {
      calls.paints.push({ layer, name, value });
    }
    getCanvas() {
      return { style: calls.cursor };
    }
    moveLayer(id: string): void {
      calls.moved.push(id);
    }
    removeSource(id: string): void {
      calls.sources.delete(id);
      calls.removedSources.push(id);
    }
    queryRenderedFeatures(box: unknown, o: { layers: string[] }): readonly RenderedHit[] {
      calls.queries.push({ box, layers: o.layers });
      return calls.rendered.filter((h) => h.layer !== undefined && o.layers.includes(h.layer.id));
    }
    fitBounds(b: unknown, o: unknown): void {
      calls.fitted.push({ b, o });
    }
    project(at: [number, number]) {
      return { x: at[0] * 10, y: at[1] * 10 };
    }
    unproject(p: [number, number]) {
      return { lng: p[0] / 10, lat: p[1] / 10 };
    }
    off(type: string, listener: unknown): void {
      if (type === 'move') calls.handlers.delete('move');
      else if (typeof listener === 'function') calls.mapClick = undefined;
    }
    removeLayer(id: string): void {
      calls.removedLayers.push(id);
    }
    getSource(id: string): MlSource | undefined {
      return sources.get(id);
    }
    doubleClickZoom = {
      enable: () => void calls.doubleClick.push(true),
      disable: () => void calls.doubleClick.push(false),
    };
    on(type: string, a: unknown, b?: unknown): void {
      if (typeof a === 'string' && typeof b === 'function') calls.hovers.set(`${type}:${a}`, b as () => void);
      else if (type === 'click') calls.mapClick = a as (e: MlMapClick) => void;
      else calls.handlers.set(type, a as () => void);
    }
    getBounds() {
      return { getWest: () => -180, getSouth: () => -90, getEast: () => 180, getNorth: () => 90 };
    }
    getZoom(): number {
      return 3;
    }
    getMinZoom(): number {
      const set = calls.minZoom.at(-1);
      return (set === undefined ? (calls.options?.['minZoom'] as number | undefined) : set) ?? 0;
    }
    getMaxZoom(): number {
      const set = calls.maxZoom.at(-1);
      return (set === undefined ? (calls.options?.['maxZoom'] as number | undefined) : set) ?? 22;
    }
    getLayer(layer: string): { type: string } | undefined {
      const spec = calls.layerSpecs.find((l) => (l as { id: string }).id === layer) as
        { type?: string } | undefined;
      return spec === undefined ? undefined : { type: spec.type ?? 'circle' };
    }
    getLayoutProperty(layer: string, name: string): unknown {
      const spec = calls.layerSpecs.find((l) => (l as { id: string }).id === layer) as
        { layout?: Record<string, unknown> } | undefined;
      return spec?.layout?.[name];
    }
    listImages(): string[] {
      return calls.images.map((i) => i.id);
    }
    setMinZoom(z: number | null): void {
      calls.minZoom.push(z);
    }
    setMaxZoom(z: number | null): void {
      calls.maxZoom.push(z);
    }
    getCenter() {
      return { lng: 0, lat: 0 };
    }
    easeTo(o: unknown): void {
      calls.eased.push(o);
    }
    remove(): void {
      calls.removed = true;
    }
  }
  class FakeMarker {
    private at: [number, number] = [0, 0];
    private readonly on_ = new Map<string, () => void>();
    constructor() {
      calls.dragMarker = (to) => {
        this.at = to;
        this.on_.get('drag')?.();
      };
    }
    setLngLat(at: [number, number]) {
      this.at = at;
      return this;
    }
    getLngLat() {
      return { lng: this.at[0], lat: this.at[1] };
    }
    addTo() {
      return this;
    }
    on(type: string, l: () => void) {
      this.on_.set(type, l);
      return { unsubscribe() {} }; // as MapLibre: a subscription, not the marker
    }
    remove() {
      return this;
    }
  }
  return {
    api: {
      Map: FakeMap as unknown as MaplibreApi['Map'],
      Marker: FakeMarker as unknown as MaplibreApi['Marker'],
    },
    calls,
  };
}

export const polygon = feature(
  'poly1',
  {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 0],
      ],
    ],
  },
  [1.5, 1],
);
export const view = {} as View;
export const styled = {
  layers: {
    m: {
      renderer: 'maplibre-2d',
      style: {
        layers: [
          {
            id: 'ub-single',
            type: 'circle',
            source: 'ub-clusters',
            filter: ['!', ['has', 'clusterId']],
            paint: { 'circle-color': ['get', 'colour'] },
          },
        ],
      },
    },
  },
} as unknown as View;
export const tick = () => new Promise((r) => setTimeout(r, 0));

export const counters = { closed: 0 };
export function mount(
  features = [pointFeature('p1', 8, 50), pointFeature('p2', 9, 51), polygon],
  v: View = view,
  options: MaplibreRendererOptions = {},
) {
  const { api, calls } = fakeMaplibre();
  const posted: ToWorker[] = [];
  const transport = (): ClusterTransport => {
    const inner = createInProcessTransport();
    return {
      ...inner,
      close: () => {
        counters.closed++;
        inner.close();
      },
      post: (m) => {
        posted.push(m);
        inner.post(m);
      },
    };
  };
  const source = testSource(features);
  const handle = createMaplibreRenderer({ load: () => Promise.resolve(api), transport, ...options }).mount(
    {} as HTMLElement,
    v,
    source,
  );
  return { handle, calls, posted, source };
}

/** A tap on the (fake) map at a screen point; what is under it is `calls.rendered`. */
export function tapMap(calls: Calls, lng = 8, lat = 50, point = { x: 10, y: 20 }): void {
  calls.mapClick?.({ lngLat: { lng, lat }, point });
}
/** A feature the fake map reports under the tap, drawn by layer `layer`. */
export const under = (
  layer: string,
  properties: Record<string, unknown>,
  geometry?: RenderedHit['geometry'],
): RenderedHit => ({
  layer: { id: layer },
  properties,
  ...(geometry === undefined ? {} : { geometry }),
});
