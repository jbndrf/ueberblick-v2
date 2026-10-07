/** Geodesic area and length on the WGS84 ellipsoid, and planar helpers in a local metric frame. */
import type { Position } from './contract';
import { at, type Ring } from './coords';

const A = 6378137;
const E2 = 0.00669437999014131;
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;

/** q(phi) of the authalic (equal-area) latitude, https://en.wikipedia.org/wiki/Latitude#Authalic_latitude */
const q = (sin: number) =>
  (1 - E2) * (sin / (1 - E2 * sin * sin) - Math.log((1 - E * sin) / (1 + E * sin)) / (2 * E));
const QP = q(1);
/** Radius of the sphere with the same surface area as the ellipsoid, squared. */
const RQ2 = ((A * A) / 2) * (1 + ((1 - E2) / E) * Math.atanh(E));

/**
 * Area of one ring in m2 (always positive). Edges are straight in (lon, sin authalic latitude), so this is an
 * equal-area cylindrical integration: exact for the ellipsoid up to the straight-in-lon/lat edge convention.
 */
export function ringAreaM2(ring: Ring): number {
  if (ring.length < 4) return 0;
  let sum = 0;
  let prevLon = at(ring, 0)[0] * RAD;
  let prevS = q(Math.sin(at(ring, 0)[1] * RAD)) / QP;
  for (let i = 1; i < ring.length; i++) {
    const lon = at(ring, i)[0] * RAD;
    const s = q(Math.sin(at(ring, i)[1] * RAD)) / QP;
    let d = lon - prevLon;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    sum += (d * (prevS + s)) / 2;
    prevLon = lon;
    prevS = s;
  }
  return Math.abs(sum) * RQ2;
}

/** Length of a polyline in metres, each edge in the local ellipsoidal metric at its mid latitude. */
export function lineLengthM(line: readonly Position[]): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) {
    const a = at(line, i - 1);
    const b = at(line, i);
    const phi = ((a[1] + b[1]) / 2) * RAD;
    const s2 = Math.sin(phi) ** 2;
    const w = Math.sqrt(1 - E2 * s2);
    const dLon = ((b[0] - a[0] + 540) % 360) - 180;
    const dx = dLon * RAD * (A / w) * Math.cos(phi);
    const dy = (b[1] - a[1]) * RAD * ((A * (1 - E2)) / (w * w * w));
    len += Math.hypot(dx, dy);
  }
  return len;
}

/** Planar x scale that makes lon/lat degrees roughly isotropic around a latitude. */
export const lonScale = (latDeg: number) => Math.max(Math.cos(latDeg * RAD), 1e-6);
