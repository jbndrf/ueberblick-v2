/**
 * Derived values (decision 0013): bbox, point on surface, centroid, geodesic area and length.
 * Computed once in the fold. All 2D; Z is ignored, except that a Point derives to itself with its Z (H1).
 */
import polylabel from 'polylabel';
import type { Derived, GeoEngine, Geometry, Point, Position } from './contract';
import { bboxOf } from './bbox';
import { at, linesOf, pointsOf, polygonsOf, type Ring } from './coords';
import { lineLengthM, lonScale, ringAreaM2 } from './measure';

type XY = readonly [number, number];

const pointAt = (x: number, y: number): Point => ({ type: 'Point', coordinates: [x, y] });

/** Planar centroid parts of a ring in a frame scaled by `k` on x, relative to `o` for precision. */
function ringMoments(ring: Ring, k: number, o: XY): { a: number; cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const x0 = (at(ring, i)[0] - o[0]) * k;
    const y0 = at(ring, i)[1] - o[1];
    const x1 = (at(ring, i + 1)[0] - o[0]) * k;
    const y1 = at(ring, i + 1)[1] - o[1];
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  return { a: a / 2, cx, cy };
}

/** Signed planar area of a polygon (holes subtract) plus its first moments, in the scaled frame. */
function polygonMoments(rings: readonly Ring[], k: number, o: XY) {
  let area = 0;
  let mx = 0;
  let my = 0;
  rings.forEach((r, i) => {
    const m = ringMoments(r, k, o);
    const sign = i === 0 ? 1 : -1; // exterior adds, holes subtract, whatever the winding
    area += sign * Math.abs(m.a);
    const s = m.a === 0 ? 0 : sign * Math.sign(m.a);
    mx += (s * m.cx) / 6;
    my += (s * m.cy) / 6;
  });
  return { area, mx, my };
}

function vertexMean(g: Geometry): XY {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const add = (p: Position) => {
    sx += p[0];
    sy += p[1];
    n++;
  };
  for (const p of pointsOf(g)) add(p);
  for (const l of linesOf(g)) l.forEach(add);
  for (const poly of polygonsOf(g)) for (const r of poly) r.forEach(add);
  return [sx / n, sy / n];
}

function centroid(g: Geometry, k: number, o: XY): XY {
  const polys = polygonsOf(g);
  if (polys.length > 0) {
    let area = 0;
    let mx = 0;
    let my = 0;
    for (const p of polys) {
      const m = polygonMoments(p, k, o);
      area += m.area;
      mx += m.mx;
      my += m.my;
    }
    if (area !== 0) return [o[0] + mx / area / k, o[1] + my / area];
    return vertexMean(g);
  }
  const lines = linesOf(g);
  if (lines.length > 0) {
    let total = 0;
    let mx = 0;
    let my = 0;
    for (const l of lines)
      for (let i = 0; i + 1 < l.length; i++) {
        const dx = (at(l, i + 1)[0] - at(l, i)[0]) * k;
        const dy = at(l, i + 1)[1] - at(l, i)[1];
        const len = Math.hypot(dx, dy);
        total += len;
        mx += (len * (at(l, i)[0] + at(l, i + 1)[0])) / 2;
        my += (len * (at(l, i)[1] + at(l, i + 1)[1])) / 2;
      }
    return total > 0 ? [mx / total, my / total] : vertexMean(g);
  }
  return vertexMean(g);
}

/** The point half way along the (planar, scaled) length of the longest line: always on the line. */
function midpointOnLine(lines: readonly Ring[], k: number): XY {
  let best: Ring = at(lines, 0);
  let bestLen = -1;
  for (const l of lines) {
    let len = 0;
    for (let i = 0; i + 1 < l.length; i++)
      len += Math.hypot((at(l, i + 1)[0] - at(l, i)[0]) * k, at(l, i + 1)[1] - at(l, i)[1]);
    if (len > bestLen) {
      bestLen = len;
      best = l;
    }
  }
  let rest = bestLen / 2;
  for (let i = 0; i + 1 < best.length; i++) {
    const a = at(best, i);
    const b = at(best, i + 1);
    const len = Math.hypot((b[0] - a[0]) * k, b[1] - a[1]);
    if (rest <= len && len > 0) {
      const t = rest / len;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    rest -= len;
  }
  return [at(best, 0)[0], at(best, 0)[1]];
}

/** Widest interior span along a few horizontal scan lines; a fallback for slivers polylabel cannot resolve. */
function scanLinePoint(rings: readonly Ring[], bbox: readonly number[]): XY | undefined {
  let best: XY | undefined;
  let bestWidth = 0;
  for (const f of [0.5, 0.37, 0.63, 0.25, 0.75, 0.13, 0.87]) {
    const y = at(bbox, 1) + (at(bbox, 3) - at(bbox, 1)) * f;
    const xs: number[] = [];
    for (const r of rings)
      for (let i = 0; i + 1 < r.length; i++) {
        const a = at(r, i);
        const b = at(r, i + 1);
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = at(xs, i + 1) - at(xs, i);
      if (w > bestWidth) {
        bestWidth = w;
        best = [(at(xs, i) + at(xs, i + 1)) / 2, y];
      }
    }
  }
  return best;
}

function labelPoint(engine: GeoEngine, poly: readonly Ring[], k: number): XY {
  const scaled = poly.map((r) => r.map((p) => [p[0] * k, p[1]] as [number, number]));
  const xs = at(scaled, 0).map((p) => p[0]);
  const ys = at(scaled, 0).map((p) => p[1]);
  const size = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const [px, py] = polylabel(scaled, Math.max(size / 10, 1e-12));
  const found: XY = [px / k, py];
  const geom: Geometry = { type: 'Polygon', coordinates: poly };
  if (engine.test('within', pointAt(found[0], found[1]), geom)) return found;
  const bb = bboxOf(geom);
  const scan = bb && scanLinePoint(poly, bb);
  if (scan && engine.test('within', pointAt(scan[0], scan[1]), geom)) return scan;
  return [at(at(poly, 0), 0)[0], at(at(poly, 0), 0)[1]]; // a vertex: on the geometry, never off it
}

function pointOnSurface(engine: GeoEngine, g: Geometry, k: number, c: XY): XY {
  const polys = polygonsOf(g);
  if (polys.length > 0) {
    let best = at(polys, 0);
    let bestArea = -Infinity;
    if (polys.length > 1)
      for (const p of polys) {
        const area = polygonMoments(p, k, [0, 0]).area;
        if (area > bestArea) {
          bestArea = area;
          best = p;
        }
      }
    return labelPoint(engine, best, k);
  }
  const lines = linesOf(g);
  if (lines.length > 0) return midpointOnLine(lines, k);
  // Points: the member closest to the centroid, so the result is one of the input points.
  let nearest: Position = at(pointsOf(g), 0);
  let d = Infinity;
  for (const p of pointsOf(g)) {
    const dd = Math.hypot((p[0] - c[0]) * k, p[1] - c[1]);
    if (dd < d) {
      d = dd;
      nearest = p;
    }
  }
  return [nearest[0], nearest[1]];
}

export function derive(engine: GeoEngine, g: Geometry): Derived {
  if (g.type === 'Point') {
    const [x, y] = g.coordinates;
    return { bbox: [x, y, x, y], pointOnSurface: g, centroid: g, areaM2: 0, lengthM: 0 };
  }
  const bbox = bboxOf(g);
  if (!bbox) throw new Error('cannot derive values of an empty geometry');
  const k = lonScale((bbox[1] + bbox[3]) / 2);
  const origin: XY = [bbox[0], bbox[1]];
  const c = centroid(g, k, origin);
  const p = pointOnSurface(engine, g, k, c);
  let areaM2 = 0;
  let lengthM = 0;
  for (const poly of polygonsOf(g)) {
    poly.forEach((r, i) => {
      const a = ringAreaM2(r);
      areaM2 += i === 0 ? a : -a;
      lengthM += lineLengthM(r);
    });
  }
  for (const l of linesOf(g)) lengthM += lineLengthM(l);
  return { bbox, pointOnSurface: pointAt(p[0], p[1]), centroid: pointAt(c[0], c[1]), areaM2, lengthM };
}
