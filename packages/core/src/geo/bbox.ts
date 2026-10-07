/**
 * 2D bbox of a geometry. Pure and engine-free, so participant code can import it without loading JSTS
 * (own subpath `@ueberblick/core/geo/bbox`).
 */
import type { Bbox, Geometry, Position } from './contract';

/** All positions in document order. Iterative on purpose: 60k geometries must not allocate per position. */
export function forEachPosition(g: Geometry, fn: (p: Position) => void): void {
  switch (g.type) {
    case 'Point':
      fn(g.coordinates);
      return;
    case 'MultiPoint':
    case 'LineString':
      for (const p of g.coordinates) fn(p);
      return;
    case 'MultiLineString':
    case 'Polygon':
      for (const r of g.coordinates) for (const p of r) fn(p);
      return;
    case 'MultiPolygon':
      for (const poly of g.coordinates) for (const r of poly) for (const p of r) fn(p);
      return;
    case 'GeometryCollection':
      for (const m of g.geometries) forEachPosition(m, fn);
  }
}

export function bboxOf(g: Geometry): Bbox | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  forEachPosition(g, (p) => {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  });
  return minX > maxX ? undefined : [minX, minY, maxX, maxY];
}

const cached = new WeakMap<Geometry, Bbox | undefined>();

/**
 * `bboxOf`, remembered per geometry object (geometries are immutable JSON, so an object's bbox never changes).
 * A derived-relation run meets the same 2k stored candidates again and again (docs/12 plan-run-derived-2k).
 */
export function bboxOfCached(g: Geometry): Bbox | undefined {
  if (cached.has(g)) return cached.get(g);
  const b = bboxOf(g);
  cached.set(g, b);
  return b;
}

/** Union of bboxes; undefined entries are skipped, and undefined comes back when none is left. */
export function unionBbox(boxes: Iterable<Bbox | undefined>): Bbox | undefined {
  let out: Bbox | undefined;
  for (const b of boxes) {
    if (!b) continue;
    out = out
      ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])]
      : [b[0], b[1], b[2], b[3]];
  }
  return out;
}

/** Do two bboxes intersect? Edge contact counts (the `Facts.near` rule). */
export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}
