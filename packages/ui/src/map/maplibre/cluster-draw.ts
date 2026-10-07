import type { ClusterItem } from '../cluster/protocol';
import type { UnclusterStats } from '../contract';
import { createListeners } from './listeners';

/** The worker's items as the GeoJSON the cluster source draws (one point per group or single feature). */
export function clusterCollection(items: readonly ClusterItem[]): {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: 'Point'; coordinates: [number, number] };
  }[];
} {
  return {
    type: 'FeatureCollection',
    features: items.map((i) => ({
      type: 'Feature',
      properties: { ...i.properties, featureId: i.featureId, clusterId: i.clusterId, count: i.count },
      geometry: { type: 'Point', coordinates: [i.lng, i.lat] },
    })),
  };
}

/**
 * The un-cluster state of one map (WP-666): the cap (null = off), the last stats and their listeners. Changing the
 * cap asks the renderer to query again; stats are reported only while it is on.
 */
export function createUncluster(redraw: () => void) {
  let cap: number | null = null;
  let last: UnclusterStats | undefined;
  const listeners = createListeners<[UnclusterStats]>();
  return {
    cap: (): number | undefined => cap ?? undefined,
    set(next: number | null): void {
      if (next === cap) return;
      cap = next;
      if (next === null) last = undefined;
      redraw();
    },
    report(stats: UnclusterStats | undefined): void {
      if (cap === null || stats === undefined) return;
      last = stats;
      listeners.emit(stats);
    },
    onStats(listener: (stats: UnclusterStats) => void): () => void {
      if (last !== undefined) listener(last);
      return listeners.add(listener);
    },
  };
}
