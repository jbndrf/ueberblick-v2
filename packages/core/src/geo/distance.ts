/**
 * Shortest distance between two geometries on the sphere of mean Earth radius: exact for point pairs
 * (haversine), and a local equirectangular projection around the probe point for point-to-segment.
 * That stays within 0.5 % of the ellipsoidal (Karney/Vincenty) value for distances up to a few hundred km at
 * German latitudes. Z is ignored (H1: a 2D metric; storage keeps Z). Intersection is decided by the engine.
 */
import type { GeoEngine, Geometry, Position } from './contract';

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

type Segment = readonly [Position, Position];

function collect(g: Geometry, points: Position[], segments: Segment[]): void {
  const line = (ps: readonly Position[]) => {
    for (let i = 0; i < ps.length; i++) {
      points.push(ps[i] as Position);
      if (i > 0) segments.push([ps[i - 1] as Position, ps[i] as Position]);
    }
  };
  switch (g.type) {
    case 'Point':
      points.push(g.coordinates);
      break;
    case 'MultiPoint':
      points.push(...g.coordinates);
      break;
    case 'LineString':
      line(g.coordinates);
      break;
    case 'MultiLineString':
    case 'Polygon':
      g.coordinates.forEach(line);
      break;
    case 'MultiPolygon':
      g.coordinates.forEach((poly) => poly.forEach(line));
      break;
    case 'GeometryCollection':
      g.geometries.forEach((x) => collect(x, points, segments));
      break;
  }
}

/** Metres from `p` to the segment, in a local equirectangular frame around `p` (exact for points). */
function pointToSegmentM(p: Position, a: Position, b: Position): number {
  const k = Math.cos(p[1] * RAD);
  const wrap = (d: number) => ((d + 540) % 360) - 180;
  const ax = wrap(a[0] - p[0]) * k * RAD * EARTH_RADIUS_M;
  const ay = (a[1] - p[1]) * RAD * EARTH_RADIUS_M;
  const bx = wrap(b[0] - p[0]) * k * RAD * EARTH_RADIUS_M;
  const by = (b[1] - p[1]) * RAD * EARTH_RADIUS_M;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function haversineM(a: Position, b: Position): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function minDistance(
  from: readonly Position[],
  to: readonly Segment[],
  toPoints: readonly Position[],
): number {
  let best = Infinity;
  for (const p of from) {
    for (const q of toPoints) best = Math.min(best, haversineM(p, q));
    for (const [a, b] of to) best = Math.min(best, pointToSegmentM(p, a, b));
  }
  return best;
}

/** Shortest distance in metres; 0 when the geometries intersect. Z is ignored (2D distance). */
export function distanceM(engine: GeoEngine, a: Geometry, b: Geometry): number {
  if (engine.test('intersects', a, b)) return 0;
  const pa: Position[] = [];
  const sa: Segment[] = [];
  const pb: Position[] = [];
  const sb: Segment[] = [];
  collect(a, pa, sa);
  collect(b, pb, sb);
  const d = Math.min(minDistance(pa, sb, pb), minDistance(pb, sa, pa));
  if (!Number.isFinite(d)) throw new Error('cannot measure the distance to an empty geometry');
  return d;
}
