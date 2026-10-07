/**
 * Fast path for a Point against a Polygon or MultiPolygon (the derived-edge hot path: a tree in a zone).
 * Ray casting with holes on plain floats. It answers only when the result is unambiguous; a point on or
 * within rounding distance of an edge (boundary, vertex) returns `undefined`, and the caller asks JSTS,
 * whose robust orientation test decides the boundary. Z is ignored.
 */
import type { Geometry, Position } from './contract';

export type AreaLocation = 'interior' | 'exterior';

/** Relative rounding bound of the cross product (a few ulps of its terms). */
const EPS = 1e-12;

/** 1 inside the ring, 0 outside, undefined when the point is on or too close to an edge. */
function inRing(px: number, py: number, ring: readonly Position[]): 0 | 1 | undefined {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as Position;
    const b = ring[i] as Position;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const ex = px - a[0];
    const ey = py - a[1];
    const cross = dx * ey - dy * ex;
    const tol = EPS * (Math.abs(dx * ey) + Math.abs(dy * ex));
    if (Math.abs(cross) <= tol) {
      // (nearly) collinear with the edge's line: on the edge when within its extent
      const t = Math.abs(dx) >= Math.abs(dy) ? [a[0], b[0], px] : [a[1], b[1], py];
      const lo = Math.min(t[0] as number, t[1] as number);
      const hi = Math.max(t[0] as number, t[1] as number);
      const slack = EPS * (Math.abs(lo) + Math.abs(hi) + 1);
      if ((t[2] as number) >= lo - slack && (t[2] as number) <= hi + slack) return undefined;
    }
    if (a[1] > py !== b[1] > py && cross > 0 === b[1] > a[1]) inside = !inside;
  }
  return inside ? 1 : 0;
}

function inPolygon(
  px: number,
  py: number,
  rings: readonly (readonly Position[])[],
): AreaLocation | undefined {
  const outer = rings[0];
  if (outer === undefined || outer.length < 4) return undefined;
  const o = inRing(px, py, outer);
  if (o === undefined) return undefined;
  if (o === 0) return 'exterior';
  for (let k = 1; k < rings.length; k++) {
    const h = inRing(px, py, rings[k] as readonly Position[]);
    if (h === undefined) return undefined;
    if (h === 1) return 'exterior';
  }
  return 'interior';
}

/** Where the point lies in the area, or `undefined` when this path cannot say (other geometry types, boundary). */
export function pointInArea(point: Geometry, area: Geometry): AreaLocation | undefined {
  if (point.type !== 'Point') return undefined;
  const [px, py] = point.coordinates;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return undefined;
  if (area.type === 'Polygon') return inPolygon(px, py, area.coordinates);
  if (area.type !== 'MultiPolygon') return undefined;
  let result: AreaLocation = 'exterior';
  for (const poly of area.coordinates) {
    const r = inPolygon(px, py, poly);
    if (r === undefined) return undefined;
    if (r === 'interior') result = 'interior';
  }
  return result;
}
