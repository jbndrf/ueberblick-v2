/** Geometry for the generated dataset: clustered points (some with Z, H1) and star-shaped polygons. */
import type { Geometry, Point, Polygon, Position } from '../../packages/core/src/geo';
import type { Random } from './prng';

const M_PER_DEG_LAT = 111_320;
type Bbox = readonly [number, number, number, number];

export interface Region {
  readonly bbox: Bbox;
  /** Metres to degrees at the region's mid latitude. */
  offset(lon: number, lat: number, dxM: number, dyM: number): [number, number];
}

export function region(bbox: Bbox): Region {
  const cos = Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180);
  return {
    bbox,
    offset: (lon, lat, dxM, dyM) => [lon + dxM / (M_PER_DEG_LAT * cos), lat + dyM / M_PER_DEG_LAT],
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round7 = (v: number) => Math.round(v * 1e7) / 1e7;

export function clusterCentres(r: Region, rnd: Random, n: number): [number, number][] {
  const [w, s, e, nn] = r.bbox;
  return Array.from({ length: n }, () => [w + rnd.next() * (e - w), s + rnd.next() * (nn - s)]);
}

/** One tree location: a centre, plus a gaussian offset. Every `zEvery`-th point carries a height (H1). */
export function treePoint(
  r: Region,
  rnd: Random,
  centres: readonly [number, number][],
  sigmaM: number,
  withZ: boolean,
): Point {
  const [lon0, lat0] = rnd.pick(centres);
  const [lon, lat] = r.offset(lon0, lat0, rnd.gauss() * sigmaM, rnd.gauss() * sigmaM);
  const [w, s, e, n] = r.bbox;
  const pos: Position = [round7(clamp(lon, w, e)), round7(clamp(lat, s, n))];
  return {
    type: 'Point',
    coordinates: withZ ? [pos[0], pos[1], Math.round((50 + rnd.next() * 200) * 10) / 10] : pos,
  };
}

/** A star-shaped (hence valid) polygon around a centre; optionally with one hole. Counter-clockwise outer ring. */
export function areaPolygon(
  r: Region,
  rnd: Random,
  centre: readonly [number, number],
  radiusM: number,
  vertices: number,
  hole: boolean,
): Polygon {
  const ring = (n: number, radius: number, jitter: number): Position[] => {
    const pts: Position[] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const rad = radius * (1 - jitter * rnd.next());
      const [lon, lat] = r.offset(centre[0], centre[1], rad * Math.cos(a), rad * Math.sin(a));
      pts.push([round7(lon), round7(lat)]);
    }
    pts.push(pts[0] as Position);
    return pts;
  };
  const outer = ring(vertices, radiusM, 0.3);
  if (!hole) return { type: 'Polygon', coordinates: [outer] };
  const inner = ring(4, radiusM * 0.3, 0).reverse(); // clockwise
  return { type: 'Polygon', coordinates: [outer, inner] };
}

export const isPoint = (g: Geometry): g is Point => g.type === 'Point';
