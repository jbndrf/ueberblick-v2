import { createDoubleClickSwitch } from './interaction';
import { classOfLayerType, type HitClass } from './tap';
import { createTapRouting } from './tap-routing';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Bbox, Position } from '@ueberblick/core/geo';
import type { FeatureId, View } from '@ueberblick/core/model';
import { ClusterClient, createWorkerTransport } from '../cluster/client';
import type { ClusterTransport } from '../cluster/protocol';
import type {
  CenterOptions,
  FeatureChange,
  FeatureSource,
  MapHandle,
  RendererMapOptions,
  ViewRenderer,
} from '../contract';
import { loadMaplibre, type MaplibreApi, type MlMap } from './api';
import { CAMERA_DEFAULT_ZOOM, cameraToMaplibre } from './camera';
import { createDetail } from './detail';
import { createListeners, createProjection } from './listeners';
import { clusterCollection, createUncluster } from './cluster-draw';
import { createMarkerLayer } from './marker';
import { createHover } from './hover';
import { SELECT_IDS, createSelectionLayer, isSelectionLayer } from './selection';
import { createOverlayLayer } from './overlay';
import { SOURCES, baseStyle, type LayerDef } from './layers';
import { CHUNK_SIZE, splitChange, yieldToMain, type YieldToMain } from './chunk';
import { pointPropertyKeys, resolveLayers } from './style';
import { createStartFit } from './start-fit';
import { createKeyValues } from './key-values';
import { createLooks } from './renderer-looks';
import { rasterizeSvg, type Rasterize } from './raster';
import type { MarkerLooks } from '@ueberblick/core/marker';
import { createBasemapSync, type PmtilesProtocol } from './renderer-basemaps';
import { createZoomLimits } from './zoom-bounds';
import { createProbe } from './probe';
import { V3_INTERACTION, WORLD, geometryDiff, noop, prefersReducedMotion } from './renderer-util';

export type { PmtilesProtocol };

/** The pack protocol (WP-662) and the tile proxy (A-033) come from `RendererMapOptions`. */
export interface MaplibreRendererOptions extends RendererMapOptions {
  /** Injected in tests; the default imports MapLibre lazily. */
  readonly load?: () => Promise<MaplibreApi>;
  readonly transport?: () => ClusterTransport;
  /** Items per chunk of a large change (default `CHUNK_SIZE`). */
  readonly chunkSize?: number;
  /** Scheduler port: gives the main thread back between chunks. */
  readonly yieldToMain?: YieldToMain;
  /** Port: does the user prefer reduced motion (docs/13)? Default: the `prefers-reduced-motion` media query. */
  readonly reducedMotion?: () => boolean;
  /** Port: loads the pmtiles protocol; only called when a pmtiles layer is about to draw. */
  readonly loadPmtiles?: () => Promise<PmtilesProtocol>;
  /** Port: MapLibre's `addProtocol` (default: the loaded library's). */
  readonly addProtocol?: (name: string, handler: unknown) => void;
  /** Port: svg to image for a marker icon (WP-674); the default draws it in the browser. */
  readonly rasterize?: Rasterize;
  readonly probe?: boolean; // the e2e seam `data-map-state` (WP-745); default: the e2e build only
}

/** The `maplibre-2d` renderer: clusters from a worker, geometry through incremental source diffs. */
export function createMaplibreRenderer(options: MaplibreRendererOptions = {}): ViewRenderer {
  const load = options.load ?? loadMaplibre;
  const makeTransport = options.transport ?? createWorkerTransport;
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const yieldNow = options.yieldToMain ?? yieldToMain;
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  return {
    mount(el, initialView: View, source: FeatureSource): MapHandle {
      const tapListeners = createListeners<[FeatureId]>();
      const extentListeners = createListeners<[Bbox]>();
      const mapTapListeners = createListeners<[Position]>();
      const moveListeners = createListeners<[]>(),
        doubleClick = createDoubleClickSwitch();
      const dragListeners = createListeners<[string, Position]>();
      const overlay = createOverlayLayer();
      const markers = createMarkerLayer(dragListeners.emit);
      const projection = createProjection(() => (loaded ? map : undefined));
      let pendingCenter: (() => void) | undefined; // a centring asked before the map exists
      const tappable = new Map<string, HitClass>(); // layer ids whose features and clusters a tap selects, by class
      const clusters = new ClusterClient(makeTransport());
      const detail = createDetail({
        leaves: (clusterId) => clusters.leaves(clusterId),
        byIds: (ids) => clusters.byIds(ids),
        map: () => map,
        reducedMotion,
        redraw: () => refresh(),
        destroyed: () => destroyed,
      });
      const zoomLimits = createZoomLimits();
      const hover = createHover();
      const selection = createSelectionLayer(
        () => map,
        () => loaded,
        // the e2e seam (WP-740): the highlight is canvas pixels, so the element carries the line layer's filter as MapLibre holds it
        (m) => el.setAttribute?.('data-select-filter', JSON.stringify(m.getFilter(SELECT_IDS.line))),
      );
      const uncluster = createUncluster(() => refresh());
      const drawn = new Set<string>(); // ids currently in the geometry source
      let map: MlMap | undefined;
      let unsubscribe: (() => void) | undefined;
      let destroyed = false;
      let scheduled = false;
      let requestSeq = 0;
      let current: readonly LayerDef[] = [];
      let currentView = initialView; // the latest view: the layers are resolved from it and the looks
      const looks = createLooks({ rasterize: options.rasterize ?? rasterizeSvg, destroyed: () => destroyed }); // the type's look by value (WP-674)
      let camera = initialView.camera; // the latest view's; the map opens at it and each new one is applied
      let currentCamera = initialView.camera; // the current view's own camera: only a view without one fits
      const startFit = createStartFit(
        (box, jump) => center(box, undefined, jump),
        () => currentCamera === undefined && map !== undefined,
      );
      let appliedCamera = JSON.stringify(camera);
      let loaded = false;
      const bound = new Set<string>(); // the view's layer ids
      const probe = createProbe(options.probe, el, () => (loaded && !destroyed ? map : undefined), bound);
      let api: MaplibreApi | undefined;
      const basemaps = createBasemapSync({
        loadPmtiles: options.loadPmtiles,
        addProtocol: options.addProtocol,
        packProtocol: options.packProtocol,
        proxy: options.proxy,
        map: () => map,
        api: () => api,
        destroyed: () => destroyed,
        lowestViewLayer: () => bound.keys().next().value,
      });

      const extent = (): Bbox => {
        if (map === undefined) return WORLD;
        const b = map.getBounds();
        return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      };

      const refresh = (): void => {
        if (map === undefined || scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (map === undefined || destroyed) return;
          const seq = ++requestSeq;
          const isolated = detail.isolated(); // the drill-down draws its members only, no query
          if (isolated !== undefined) {
            void Promise.resolve().then(() => {
              if (seq === requestSeq && !destroyed)
                map?.getSource(SOURCES.clusters)?.setData(clusterCollection(isolated));
            });
            return;
          }
          void clusters.queryCapped(extent(), map.getZoom(), uncluster.cap()).then(({ items, stats }) => {
            if (seq !== requestSeq || destroyed) return;
            map?.getSource(SOURCES.clusters)?.setData(clusterCollection(items));
            uncluster.report(stats);
          });
        });
      };

      const applyGeometry = (change: FeatureChange): void => {
        const geometry = map?.getSource(SOURCES.geometry);
        const diff = geometry === undefined ? undefined : geometryDiff(drawn, change);
        if (diff !== undefined) void geometry?.updateData(diff);
      };

      // Layers only: sources (and so the features in them) stay untouched when a style changes.
      // Every layer on a renderer source is tappable, whatever its id.
      const drawLayers = (m: MlMap, layers: readonly LayerDef[]): void => {
        for (const id of bound) m.removeLayer(id);
        bound.clear();
        tappable.clear();
        // every source first: a layer may come before the LayerDef that declares its source
        for (const { source: declared } of layers) {
          if (declared !== undefined && m.getSource(declared.id) === undefined)
            m.addSource(declared.id, declared.spec);
        }
        for (const layer of layers) {
          m.addLayer(layer.spec);
          const { id, source: sourceId, type } = layer.spec as { id: string; source?: string; type?: string };
          bound.add(id);
          if ((sourceId === SOURCES.clusters || sourceId === SOURCES.geometry) && !isSelectionLayer(id))
            tappable.set(id, classOfLayerType(type));
        }
        hover.watch(m, tappable.keys());
        selection.apply(m); // the highlight layers are new: the held selection goes on them
        overlay.raise();
      };

      const taps = createTapRouting({
        map: () => map,
        tappable,
        feature: (id) => tapListeners.emit(id),
        cluster: (id, at) => detail.click(id, at),
        empty: (at) => mapTapListeners.emit(at),
      });
      const onMapClick = taps.onClick;

      const center = (
        target: Position | Bbox,
        opts: CenterOptions | undefined,
        jump: { duration?: number } = {},
      ): void => {
        if (map !== undefined) zoomLimits.centre(map, target, opts, reducedMotion() ? { duration: 0 } : jump);
      };

      // A view with a camera moves the map there; the same camera again (a style edit) leaves the map where the user put it.
      const applyCamera = (next: View['camera']): void => {
        const key = JSON.stringify(next);
        if (next === undefined || key === appliedCamera || map === undefined) return;
        appliedCamera = key;
        map.easeTo({
          ...zoomLimits.within(cameraToMaplibre(next)),
          ...(reducedMotion() ? { duration: 0 } : {}),
        });
      };

      const applyKeys = createKeyValues(clusters, source, yieldNow, () => refresh());

      const applyChange = (change: FeatureChange): void => {
        clusters.apply(change);
        applyGeometry(change);
      };

      // Large changes (the initial delivery) go in chunks with a yield between each, so no task
      // outlasts the long-task budget. Later changes queue behind, keeping their order. Clusters are
      // requested after the first chunk (markers appear early) and after the last one.
      const queue: FeatureChange[] = [];
      let draining = false;
      const drain = async (): Promise<void> => {
        draining = true;
        let first = true;
        while (queue.length > 0 && !destroyed) {
          const part = queue.shift();
          if (part === undefined) break;
          applyChange(part);
          if (first || queue.length === 0) refresh();
          first = false;
          if (queue.length > 0) await yieldNow();
        }
        draining = false;
      };
      const onChange = (change: FeatureChange): void => {
        startFit.feed(change.add);
        queue.push(...splitChange(change, chunkSize));
        if (!draining) void drain();
      };

      const ready = (async () => {
        try {
          current = resolveLayers(currentView, looks.plan()); // a bad style rejects `ready` before any map work
        } catch (error) {
          clusters.close();
          throw error;
        }
        clusters.setKeys(pointPropertyKeys(current), []); // before features arrive: no values to send
        api = await load();
        if (destroyed) return;
        const start = zoomLimits.within(
          camera === undefined
            ? { center: [10, 51] as [number, number], zoom: 5 }
            : { zoom: CAMERA_DEFAULT_ZOOM, ...cameraToMaplibre(camera) },
        );
        appliedCamera = JSON.stringify(camera);
        const m = new api.Map({
          container: el,
          style: baseStyle(),
          ...start,
          ...zoomLimits.options(),
          ...V3_INTERACTION,
        });
        m.touchZoomRotate?.disableRotation();
        map = m;
        await new Promise<void>((resolve) => m.on('load', resolve));
        if (destroyed) return;
        loaded = true;
        await basemaps.sync(); // below the view layers, which are drawn next
        await looks.addImages(m); // the icons the layers name are on the map before they draw
        if (destroyed) return;
        drawLayers(m, current); // the latest view, also when `setView` ran while loading
        markers.attach(api, m);
        m.on('move', () => moveListeners.emit());
        m.on('movestart', (e) => {
          if (e.originalEvent !== undefined) startFit.close(); // the person took the map: no later slice moves it
        });
        doubleClick.attach(m); // v3's drawing turns double-click zoom off
        overlay.attach(m); // above the view's layers; what was shown before the load is in it
        m.on('click', onMapClick);
        if (probe !== undefined) m.on('idle', probe);
        pendingCenter?.();
        pendingCenter = undefined;
        m.on('moveend', () => {
          refresh();
          extentListeners.emit(extent());
        });
        unsubscribe = source.subscribe(WORLD, onChange);
      })();

      return {
        ready,
        onFeatureTap: tapListeners.add,
        onMapTap: mapTapListeners.add,
        captureTaps: taps.capture,
        onClusterTap: detail.onTap,
        isolate: detail.isolate,
        centerOn(target, opts) {
          if (destroyed) return;
          if (map === undefined || !loaded) pendingCenter = () => center(target, opts);
          else center(target, opts);
        },
        zoomBy(delta) {
          if (destroyed || map === undefined || !loaded) return;
          map.easeTo({
            ...zoomLimits.within({ zoom: map.getZoom() + delta }),
            ...(reducedMotion() ? { duration: 0 } : {}),
          });
        },
        setBasemaps(config, selection) {
          basemaps.want(config, selection);
          if (loaded) void basemaps.sync().catch(noop);
        },
        addMarker: (id, at, options) => !destroyed && markers.add(id, at, options),
        moveMarker: (id, at) => markers.move(id, at),
        markerPosition: (id) => markers.position(id),
        removeMarker: (id) => markers.remove(id),
        onMarkerDrag: dragListeners.add,
        project: projection.project,
        unproject: projection.unproject,
        onMove: moveListeners.add,
        setDoubleClickZoom: doubleClick.set,
        setSelected: (next) => !destroyed && selection.set(next),
        showOverlay: (id, geometry, style) => overlay.show(id, geometry, style),
        clearOverlay: (id) => overlay.clear(id),
        extent,
        onExtentChange: extentListeners.add,
        setZoomBounds(next) {
          if (destroyed) return;
          zoomLimits.set(next, loaded ? map : undefined);
          clusters.setMaxZoom(next?.max); // v3 clusters to the project's max zoom (`getGlobalMaxZoom`)
          if (loaded) refresh();
        },
        setUncluster: uncluster.set,
        onUnclusterStats: uncluster.onStats,
        setLooks(next: MarkerLooks | undefined) {
          if (destroyed) return;
          looks.set(next);
          clusters.setClassify(next?.property);
          const layers = resolveLayers(currentView, looks.plan());
          const m = map;
          if (!loaded || m === undefined) {
            current = layers; // `ready` draws it, with the images
            clusters.setKeys(pointPropertyKeys(layers), []);
            return;
          }
          void looks.addImages(m).then(() => {
            if (destroyed) return;
            current = layers;
            drawLayers(m, layers);
            applyKeys(layers);
            refresh();
          });
        },
        setView(next) {
          const layers = resolveLayers(next, looks.plan()); // throws before the map is touched
          currentView = next;
          current = layers;
          camera = next.camera ?? camera;
          currentCamera = next.camera;
          startFit.reset(); // a no-camera view fits the first delivery of its own
          if (!loaded || map === undefined) {
            // Not drawn yet: `ready` draws `current`. No features are held, so no values to send.
            clusters.setKeys(pointPropertyKeys(layers), []);
            return;
          }
          drawLayers(map, layers);
          applyKeys(layers);
          applyCamera(next.camera);
        },
        destroy() {
          destroyed = true;
          startFit.close();
          applyKeys.cancel();
          unsubscribe?.();
          queue.length = 0;
          detail.dispose();
          clusters.close();
          overlay.dispose();
          markers.dispose();
          map?.remove();
          map = undefined;
        },
      };
    },
  };
}
