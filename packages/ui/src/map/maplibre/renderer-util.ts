import type { Bbox } from '@ueberblick/core/geo';
import type { GeoJsonDiff, GeoJsonFeature } from './api';
import type { FeatureChange, MapFeature } from '../contract';

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const noop = (): void => undefined;
export const WORLD: Bbox = [-180, -90, 180, 90];

export function geoFeature(f: MapFeature): GeoJsonFeature {
  return { type: 'Feature', id: f.id, properties: { ...f.properties, id: f.id }, geometry: f.geometry };
}

/** The extent of the finite anchors, in one pass (no intermediate arrays); undefined when there is none. */
export function anchorsExtent(adds: readonly MapFeature[]): Bbox | undefined {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of adds) {
    const a = f.anchor;
    if (!Number.isFinite(a[0]) || !Number.isFinite(a[1])) continue;
    if (a[0] < minLon) minLon = a[0];
    if (a[0] > maxLon) maxLon = a[0];
    if (a[1] < minLat) minLat = a[1];
    if (a[1] > maxLat) maxLat = a[1];
  }
  return minLon === Infinity ? undefined : [minLon, minLat, maxLon, maxLat];
}

/** The smallest box holding both. */
export function unionBox(a: Bbox, b: Bbox): Bbox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** An update carries the properties too: the layers' colour and width read them (a status change must repaint). */
function shapeUpdate(f: MapFeature): NonNullable<GeoJsonDiff['update']>[number] {
  const props = geoFeature(f).properties;
  return {
    id: f.id,
    newGeometry: f.geometry,
    removeAllProperties: true,
    addOrUpdateProperties: Object.entries(props).map(([key, value]) => ({ key, value })),
  };
}

/**
 * The diff of the geometry source for a change (lines and areas only, points are cluster output); `drawn` is the set
 * of ids in the source and is updated. Undefined when nothing changes.
 */
export function geometryDiff(drawn: Set<string>, change: FeatureChange): GeoJsonDiff | undefined {
  const isShape = (f: MapFeature): boolean => f.geometry.type !== 'Point';
  const add = change.add.filter(isShape);
  const update: NonNullable<GeoJsonDiff['update']>[number][] = [];
  const remove: string[] = change.remove.filter((id) => drawn.has(id));
  for (const f of change.update) {
    if (isShape(f)) {
      if (drawn.has(f.id)) update.push(shapeUpdate(f));
      else add.push(f);
    } else if (drawn.has(f.id)) remove.push(f.id);
  }
  for (const f of add) drawn.add(f.id);
  for (const id of remove) drawn.delete(id);
  if (add.length + update.length + remove.length === 0) return undefined;
  return { add: add.map(geoFeature), update, remove };
}

/** How v3's map is handled (`MapCanvas.svelte:1024-1030`): pan and pinch-zoom, no rotation, no tilt, a few pixels of slack on a tap. */
export const V3_INTERACTION = {
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  clickTolerance: 5,
  attributionControl: { compact: true },
} as const;
