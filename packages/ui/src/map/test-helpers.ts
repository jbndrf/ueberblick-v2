// Shared by the map specs and the benchmark. Not exported from the package.
import type { Bbox, Geometry, Position } from '@ueberblick/core/geo';
import type { FeatureId, Json } from '@ueberblick/core/model';
import type { FeatureChange, FeatureSource, MapFeature } from './contract';

export function feature(
  id: string,
  geometry: Geometry,
  anchor: Position,
  properties: { [key: string]: Json } = {},
): MapFeature {
  return { id: id as FeatureId, anchor, geometry, properties };
}

export function pointFeature(
  id: string,
  lng: number,
  lat: number,
  properties: { [key: string]: Json } = {},
): MapFeature {
  return feature(id, { type: 'Point', coordinates: [lng, lat] }, [lng, lat], properties);
}

/** An in-memory source that counts what it delivers. */
export interface TestSource extends FeatureSource {
  emit(change: Partial<FeatureChange>): void;
  readonly delivered: FeatureChange[];
}

export function testSource(initial: readonly MapFeature[]): TestSource {
  const listeners = new Set<(c: FeatureChange) => void>();
  const delivered: FeatureChange[] = [];
  const inBox = (bbox: Bbox): MapFeature[] =>
    initial.filter(
      (f) =>
        f.anchor[0] >= bbox[0] && f.anchor[0] <= bbox[2] && f.anchor[1] >= bbox[1] && f.anchor[1] <= bbox[3],
    );
  return {
    delivered,
    query: inBox,
    *queryChunks(bbox, size = 4000) {
      const all = inBox(bbox);
      for (let at = 0; at < all.length; at += size) yield all.slice(at, at + size);
    },
    subscribe(_bbox, listener) {
      listeners.add(listener);
      const first: FeatureChange = { add: initial, update: [], remove: [] };
      delivered.push(first);
      listener(first);
      return () => listeners.delete(listener);
    },
    emit(change) {
      const full: FeatureChange = { add: [], update: [], remove: [], ...change };
      delivered.push(full);
      for (const l of listeners) l(full);
    },
  };
}
