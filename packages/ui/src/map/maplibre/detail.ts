// The cluster detail of the MapLibre renderer (WP-653): what a tap on a cluster does and v3's drill-down
// (`+page.svelte:1871-1925`, `MapCanvas.svelte:553-604`). Cluster ids and positions come from the worker's index
// (`leaves`); nothing here walks the features.
import type { Bbox, Position } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import type { ClusterItem } from '../cluster/protocol';
import type { ClusterTap } from '../contract';
import type { MlMap } from './api';
import { createListeners } from './listeners';

/** v3: a second tap on the same cluster within this time zooms; otherwise the first one opens the sheet. */
export const DOUBLE_TAP_MS = 300;
const MAX_ZOOM = 18;
/** v3: padding of the double-tap fit (`MapCanvas.svelte`) and of the drill-down fit (`+page.svelte:1905`). */
const TAP_PADDING = 40;
const ISOLATE_PADDING = 60;

export interface DetailDeps {
  readonly leaves: (clusterId: number) => Promise<readonly ClusterItem[]>;
  /** The anchors of any features by id, from the worker's index (a cluster's members and a relation's children alike). */
  readonly byIds: (ids: readonly string[]) => Promise<readonly ClusterItem[]>;
  readonly map: () => MlMap | undefined;
  readonly reducedMotion: () => boolean;
  /** The clusters should be drawn again (the isolation changed). */
  readonly redraw: () => void;
  readonly destroyed: () => boolean;
}

export interface Detail {
  onTap: (listener: (tap: ClusterTap) => void) => () => void;
  /** A click on a cluster. */
  click(clusterId: number, at: Position): void;
  isolate(ids: readonly FeatureId[] | null): void;
  /** The singles to draw instead of the clusters, while isolated. */
  isolated(): readonly ClusterItem[] | undefined;
  dispose(): void;
}

const positionOf = (i: ClusterItem): Position => [i.lng, i.lat];

function boundsOf(items: readonly ClusterItem[]): Bbox | undefined {
  if (items.length === 0) return undefined;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const i of items) {
    if (i.lng < w) w = i.lng;
    if (i.lng > e) e = i.lng;
    if (i.lat < s) s = i.lat;
    if (i.lat > n) n = i.lat;
  }
  return [w, s, e, n];
}

type View = { center: Position; zoom: number };

export function createDetail(deps: DetailDeps): Detail {
  const jump = (): { duration?: number } => (deps.reducedMotion() ? { duration: 0 } : {});
  const fit = (b: Bbox, o: { padding: number; maxZoom: number }): void =>
    deps.map()?.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { ...o, ...jump() },
    );
  const view = (): View | undefined => {
    const m = deps.map();
    const c = m?.getCenter();
    return m === undefined || c === undefined ? undefined : { center: [c.lng, c.lat], zoom: m.getZoom() };
  };
  const restore = (v: View): void =>
    deps.map()?.easeTo({ center: [v.center[0], v.center[1]], zoom: v.zoom, ...jump() });
  const taps = createListeners<[ClusterTap]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastClicked: number | undefined;
  let isolation = 0; // the latest isolate call, so a slow answer cannot undo a later one
  let shown: readonly ClusterItem[] | undefined;
  let saved: View | undefined;

  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    lastClicked = undefined;
  };

  const single = (clusterId: number, at: Position): void => {
    void deps.leaves(clusterId).then((items) => {
      if (deps.destroyed()) return;
      taps.emit({
        at,
        count: items.length,
        members: items.map((i) => ({ id: (i.featureId ?? '') as FeatureId, at: positionOf(i) })),
      });
    });
  };

  const zoomTo = (clusterId: number): void => {
    void deps.leaves(clusterId).then((items) => {
      const bbox = boundsOf(items);
      if (!deps.destroyed() && bbox !== undefined) fit(bbox, { padding: TAP_PADDING, maxZoom: MAX_ZOOM });
    });
  };

  return {
    onTap: taps.add,
    click(clusterId, at) {
      if (timer !== undefined && lastClicked === clusterId) {
        stopTimer();
        zoomTo(clusterId);
        return;
      }
      stopTimer();
      lastClicked = clusterId;
      timer = setTimeout(() => {
        timer = undefined;
        lastClicked = undefined;
        single(clusterId, at);
      }, DOUBLE_TAP_MS);
    },
    isolate(ids) {
      const mine = ++isolation;
      if (ids === null) {
        if (shown === undefined) return;
        shown = undefined;
        if (saved !== undefined) restore(saved);
        saved = undefined;
        deps.redraw();
        return;
      }
      void deps.byIds(ids).then((chosen) => {
        // a later call (another row, or the end) wins over an answer still on its way
        if (mine !== isolation || deps.destroyed() || chosen.length === 0) return;
        if (shown === undefined) saved = view();
        shown = chosen;
        deps.redraw();
        const bbox = boundsOf(chosen);
        if (bbox !== undefined) fit(bbox, { padding: ISOLATE_PADDING, maxZoom: MAX_ZOOM });
      });
    },
    isolated: () => shown,
    dispose: stopTimer,
  };
}
