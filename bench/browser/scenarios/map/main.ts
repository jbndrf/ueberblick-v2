// Scenario map-60k: the real MapLibre renderer with 60k generated features and the cluster worker.
// The runner calls `begin()` (after fixture generation), then pans and zooms with real mouse input,
// then `update()` for one feature change.
import type { FeatureId, View } from '@ueberblick/core';
import type { FeatureChange, FeatureSource, MapFeature } from '../../../../packages/ui/src/map/contract';
import { loadMaplibre, type MaplibreApi, type MlSource } from '../../../../packages/ui/src/map/maplibre/api';
import { SOURCES } from '../../../../packages/ui/src/map/maplibre/layers';
import { createMaplibreRenderer } from '../../../../packages/ui/src/map/maplibre/renderer';
import { pointFeature } from '../../../../packages/ui/src/map/test-helpers';
import { FREE_SPOT, generateFeatures } from '../../lib/data';
import { afterPaint, installProbe, slowdown } from '../../lib/probe';

const bench = installProbe();
const m = bench.metrics;
const get = (k: string): number => m[k] ?? Number.NaN;
for (const k of [
  'generate',
  'beginAt',
  'subscribeAt',
  'moves',
  'deliver',
  'firstMarkers',
  'clusterBuild',
  'updateMain',
  'deltaVisible',
]) {
  m[k] = Number.NaN;
}

const g0 = performance.now();
const features: MapFeature[] = generateFeatures(60_000, 4711);
m['generate'] = performance.now() - g0;

// The moved feature lands on the free spot inside the initial view, so it is a single marker.
const MOVED_TO = FREE_SPOT;
let watchId: string | null = null;
let watchStart = 0;

interface ClusterData {
  readonly features: readonly {
    readonly properties: { readonly featureId?: string };
    readonly geometry: unknown;
  }[];
}

function watchSource(real: MlSource): MlSource {
  return {
    updateData: (d) => real.updateData(d),
    setData(data) {
      real.setData(data);
      const items = (data as unknown as ClusterData).features;
      if (Number.isNaN(m['firstMarkers']) && items.length > 0) {
        m['firstMarkers'] = performance.now();
        m['clusterBuild'] = get('firstMarkers') - get('subscribeAt');
      }
      if (watchId !== null && items.some((f) => f.properties.featureId === watchId)) {
        watchId = null;
        void afterPaint().then((t) => (m['deltaVisible'] = t - watchStart));
      }
    },
  };
}

const listeners = new Set<(c: FeatureChange) => void>();
const source: FeatureSource = {
  query: () => features,
  *queryChunks(_bbox, size = 4000) {
    for (let at = 0; at < features.length; at += size) yield features.slice(at, at + size);
  },
  subscribe(_bbox, listener) {
    listeners.add(listener);
    m['subscribeAt'] = performance.now();
    listener({ add: features, update: [], remove: [] });
    m['deliver'] = performance.now() - get('subscribeAt');
    return () => listeners.delete(listener);
  },
};

const renderer = createMaplibreRenderer({
  // The same library and code path as the app; only the cluster source is watched for timing.
  load: async (): Promise<MaplibreApi> => {
    const api = await loadMaplibre();
    class Watched extends api.Map {
      constructor(options: ConstructorParameters<typeof api.Map>[0]) {
        super(options);
        this.on('moveend', () => (m['moves'] = (Number.isFinite(get('moves')) ? get('moves') : 0) + 1));
      }
      override getSource(id: string): MlSource | undefined {
        const real = super.getSource(id);
        return real !== undefined && id === SOURCES.clusters ? watchSource(real) : real;
      }
    }
    return { Map: Watched, Marker: api.Marker };
  },
});

bench.begin = () => {
  slowdown();
  m['beginAt'] = performance.now();
  const el = document.getElementById('map');
  if (el === null) throw new Error('no map element');
  renderer.mount(el, { renderer: 'maplibre-2d' } as unknown as View, source);
};

/** One feature changes (an update delivered by the source). */
(window as unknown as { benchUpdate: () => void }).benchUpdate = () => {
  const moved = pointFeature('f5', MOVED_TO[0], MOVED_TO[1]);
  watchId = moved.id satisfies FeatureId;
  watchStart = performance.now();
  for (const l of listeners) l({ add: [], update: [moved], remove: [] });
  m['updateMain'] = performance.now() - watchStart;
};

bench.ready = true;
