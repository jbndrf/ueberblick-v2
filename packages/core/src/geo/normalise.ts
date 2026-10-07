/** RFC 7946 shape: 7 decimals, closed rings, exterior counter-clockwise, holes clockwise. Idempotent; Z kept. */
import type { Geometry, Position } from './contract';
import { at, mapPositions, round7, signedArea2, type Ring } from './coords';

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

const roundPosition = (p: Position): Position =>
  p.length === 3 ? [round7(p[0]), round7(p[1]), p[2]] : [round7(p[0]), round7(p[1])];

function shape(ring: Ring, exterior: boolean): Ring {
  if (ring.length < 3) return ring;
  const closed = same(at(ring, 0), at(ring, ring.length - 1)) ? ring : [...ring, at(ring, 0)];
  const area = signedArea2(closed);
  if (area === 0) return closed;
  return area > 0 === exterior ? closed : [...closed].reverse();
}

const polygon = (rings: readonly Ring[]): Ring[] => rings.map((r, i) => shape(r, i === 0));

export function normalise(g: Geometry): Geometry {
  const r = mapPositions(g, roundPosition);
  switch (r.type) {
    case 'Polygon':
      return { type: 'Polygon', coordinates: polygon(r.coordinates) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: r.coordinates.map(polygon) };
    case 'GeometryCollection':
      return { type: 'GeometryCollection', geometries: r.geometries.map(normalise) };
    default:
      return r;
  }
}
