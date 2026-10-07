import { RENDERERS } from '@ueberblick/core/registry';
import type { Bbox, Geometry, Position } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import type { MapConfig, View } from '@ueberblick/core/model';
import type { MapSelection } from '@ueberblick/core/registry';
import type { MarkerLooks } from '@ueberblick/core/marker';
import {
  UnknownRendererError,
  type CenterOptions,
  type ClusterTap,
  type FeatureSource,
  type MapHandle,
  type MarkerOptions,
  type OverlayStyle,
  type RendererMapOptions,
  type RendererMap,
  type UnclusterStats,
  type Selection,
  type ViewRenderer,
} from './contract';

const WORLD: Bbox = [-180, -90, 180, 90];

/**
 * The MapLibre renderer, loaded on first `mount`: importing this module pulls in neither the
 * renderer, its style validator nor MapLibre. The handle is usable at once; listeners are handed
 * to the real handle when it exists, and the latest view is the one it mounts with.
 */
function lazyMaplibreRenderer(options: RendererMapOptions): ViewRenderer {
  return {
    mount(el: HTMLElement, initialView: View, source: FeatureSource): MapHandle {
      // `Required` makes a method dropped from this forwarding handle a compile error, not a silent no-op (WP-740).
      let inner: MapHandle | undefined;
      let destroyed = false;
      let view = initialView;
      let basemaps: [MapConfig, MapSelection] | undefined;
      /** Listeners held for the handle that does not exist yet; `offs` are the unsubscribes of the real handle. */
      type Held<L> = { set: Set<L>; offs: Map<L, () => void> };
      const held = <L>(): Held<L> => ({ set: new Set<L>(), offs: new Map<L, () => void>() });
      /** Subscribes `listener`; once the real handle exists its unsubscribe is kept so a later `off` reaches it. */
      const subscribe = <L>(
        h: Held<L>,
        listener: L,
        attach: (real: MapHandle, l: L) => (() => void) | undefined,
      ) => {
        h.set.add(listener);
        const off = inner === undefined ? undefined : attach(inner, listener);
        if (off !== undefined) h.offs.set(listener, off);
        return () => {
          h.set.delete(listener);
          h.offs.get(listener)?.();
          h.offs.delete(listener);
        };
      };
      /** Replays held listeners onto the freshly created real handle. */
      const replay = <L>(
        h: Held<L>,
        real: MapHandle,
        attach: (real: MapHandle, l: L) => (() => void) | undefined,
      ) => {
        for (const l of h.set) {
          const off = attach(real, l);
          if (off !== undefined) h.offs.set(l, off);
        }
      };
      const taps = held<(id: FeatureId) => void>();
      const extents = held<(extent: Bbox) => void>();
      const mapTaps = held<(at: Position) => void>();
      const clusterTaps = held<(tap: ClusterTap) => void>();
      const overlays = new Map<string, { geometry: Geometry; style: OverlayStyle }>();
      const drags = held<(id: string, at: Position) => void>();
      const moves = held<() => void>();
      const markers = new Map<string, { at: Position; options: MarkerOptions }>();
      let doubleClickZoom = true;
      let capturing = false;
      let selected: Selection | null = null;
      let uncluster: number | null = null;
      let looks: MarkerLooks | undefined;
      let zoomBounds: Parameters<NonNullable<MapHandle['setZoomBounds']>>[0];
      const stats = held<(s: UnclusterStats) => void>();
      // Camera intents made before load replay in call order, so the last one wins (an isolate fits the view itself).
      let seq = 0;
      let pendingCenter: { args: [Position | Bbox, CenterOptions | undefined]; at: number } | undefined;
      let isolated: { ids: readonly FeatureId[]; at: number } | undefined;

      const ready = import('./maplibre/renderer').then(async ({ createMaplibreRenderer }) => {
        if (destroyed) return;
        const handle = createMaplibreRenderer(options).mount(el, view, source);
        inner = handle;
        replay(taps, handle, (h, l) => h.onFeatureTap(l));
        replay(extents, handle, (h, l) => h.onExtentChange(l));
        replay(mapTaps, handle, (h, l) => h.onMapTap(l));
        replay(clusterTaps, handle, (h, l) => h.onClusterTap?.(l));
        if (basemaps !== undefined) handle.setBasemaps?.(...basemaps);
        replay(drags, handle, (h, l) => h.onMarkerDrag(l));
        replay(moves, handle, (h, l) => h.onMove(l));
        for (const [id, m] of markers) handle.addMarker(id, m.at, m.options);
        for (const [id, o] of overlays) handle.showOverlay(id, o.geometry, o.style);
        if (!doubleClickZoom) handle.setDoubleClickZoom(false);
        if (capturing) handle.captureTaps?.(true);
        if (selected !== null) handle.setSelected?.(selected);
        if (uncluster !== null) handle.setUncluster?.(uncluster);
        replay(stats, handle, (h, l) => h.onUnclusterStats?.(l));
        if (looks !== undefined) handle.setLooks?.(looks);
        if (zoomBounds !== undefined) handle.setZoomBounds?.(zoomBounds);
        const camera: { at: number; run: () => void }[] = [];
        const c = pendingCenter;
        if (c !== undefined) camera.push({ at: c.at, run: () => handle.centerOn(...c.args) });
        const iso = isolated;
        if (iso !== undefined) camera.push({ at: iso.at, run: () => handle.isolate?.(iso.ids) });
        camera.sort((x, y) => x.at - y.at);
        for (const step of camera) step.run();
        await handle.ready;
      });

      const forwarding: Required<MapHandle> = {
        ready,
        onFeatureTap(listener) {
          return subscribe(taps, listener, (h, l) => h.onFeatureTap(l));
        },
        onMapTap(listener) {
          return subscribe(mapTaps, listener, (h, l) => h.onMapTap(l));
        },
        onClusterTap(listener) {
          return subscribe(clusterTaps, listener, (h, l) => h.onClusterTap?.(l));
        },
        isolate(ids) {
          isolated = ids === null || ids === undefined ? undefined : { ids, at: seq++ };
          inner?.isolate?.(ids);
        },
        centerOn(target, opts) {
          if (inner === undefined) pendingCenter = { args: [target, opts], at: seq++ };
          else inner.centerOn(target, opts);
        },
        zoomBy: (delta) => inner?.zoomBy(delta),
        showOverlay(id, geometry, style) {
          overlays.set(id, { geometry, style });
          inner?.showOverlay(id, geometry, style);
        },
        clearOverlay(id) {
          overlays.delete(id);
          inner?.clearOverlay(id);
        },
        addMarker(id, at, options) {
          markers.set(id, { at, options });
          inner?.addMarker(id, at, options);
        },
        moveMarker(id, at) {
          const m = markers.get(id);
          if (m !== undefined) markers.set(id, { ...m, at });
          inner?.moveMarker(id, at);
        },
        markerPosition: (id) => inner?.markerPosition(id) ?? markers.get(id)?.at,
        removeMarker(id) {
          markers.delete(id);
          inner?.removeMarker(id);
        },
        onMarkerDrag(listener) {
          return subscribe(drags, listener, (h, l) => h.onMarkerDrag(l));
        },
        captureTaps(on) {
          capturing = on;
          inner?.captureTaps?.(on);
        },
        setDoubleClickZoom(on) {
          doubleClickZoom = on;
          inner?.setDoubleClickZoom(on);
        },
        project: (at) => inner?.project(at),
        unproject: (point) => inner?.unproject(point),
        onMove(listener) {
          return subscribe(moves, listener, (h, l) => h.onMove(l));
        },
        extent: () => inner?.extent() ?? WORLD,
        onExtentChange(listener) {
          return subscribe(extents, listener, (h, l) => h.onExtentChange(l));
        },
        setBasemaps(config, selection) {
          basemaps = [config, selection];
          inner?.setBasemaps?.(config, selection);
        },
        setUncluster(cap) {
          uncluster = cap;
          inner?.setUncluster?.(cap);
        },
        onUnclusterStats(listener) {
          return subscribe(stats, listener, (h, l) => h.onUnclusterStats?.(l));
        },
        setLooks(next) {
          looks = next;
          inner?.setLooks?.(next);
        },
        setZoomBounds(next) {
          zoomBounds = next;
          inner?.setZoomBounds?.(next);
        },
        setSelected(next) {
          selected = next;
          inner?.setSelected?.(next);
        },
        setView(next) {
          view = next;
          inner?.setView(next);
        },
        destroy() {
          destroyed = true;
          inner?.destroy();
        },
      };
      return forwarding;
    },
  };
}

/** The built-in renderers keyed by the `RENDERERS` registry (H1). MapLibre loads on `mount`. */
export function createRendererMap(
  extra: ReadonlyMap<string, ViewRenderer> = new Map(),
  options: RendererMapOptions = {},
): RendererMap {
  const map = new Map<string, ViewRenderer>([[RENDERERS.keys[0], lazyMaplibreRenderer(options)]]);
  for (const [key, renderer] of extra) map.set(key, renderer);
  return map;
}

/** Looks up a renderer; an unregistered key is an `UnknownRendererError`. */
export function getRenderer(renderers: RendererMap, key: string): ViewRenderer {
  const renderer = renderers.get(key);
  if (renderer === undefined) throw new UnknownRendererError(key);
  return renderer;
}
