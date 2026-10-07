/** Source CRS to WGS84 (proj4). Pure: the definitions are inline, no network, no grid files. */
import proj4 from 'proj4';
import type { Geometry, Position } from './contract';
import { firstPosition, mapPositions, round7 } from './coords';
import { GEO_SOURCE_CRS, type GeoSourceCrs } from '../registry';

/** DHDN to WGS84 Helmert parameters (EPSG:1777, the usual 7-parameter set for Germany). */
const DHDN = '+ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs';
const ETRS89_UTM = (zone: number) => `+proj=utm +zone=${zone} +ellps=GRS80 +units=m +no_defs`;
const GAUSS_KRUEGER = (cm: number, zone: number) =>
  `+proj=tmerc +lat_0=0 +lon_0=${cm} +k=1 +x_0=${zone * 1e6 + 500000} +y_0=0 ${DHDN}`;

/** proj4 definition per registry key. Typed against the registry so a new CRS cannot be forgotten. */
const DEFINITIONS: Record<GeoSourceCrs, string | undefined> = {
  'EPSG:4326': undefined,
  // ETRS89 is coincident with WGS84 to about a metre; the standard practice is no shift.
  'EPSG:4258': undefined,
  'EPSG:25832': ETRS89_UTM(32),
  'EPSG:25833': ETRS89_UTM(33),
  'EPSG:31466': GAUSS_KRUEGER(6, 2),
  'EPSG:31467': GAUSS_KRUEGER(9, 3),
  'EPSG:31468': GAUSS_KRUEGER(12, 4),
  'EPSG:31469': GAUSS_KRUEGER(15, 5),
};

const converters = new Map<GeoSourceCrs, proj4.Converter>();

function converter(crs: GeoSourceCrs): proj4.Converter | undefined {
  const def = DEFINITIONS[crs];
  if (def === undefined) return undefined;
  let c = converters.get(crs);
  if (!c) {
    c = proj4(def, 'WGS84');
    converters.set(crs, c);
  }
  return c;
}

/** Reproject to WGS84 and round to 7 decimals. Z passes through unchanged (H1). */
export function toWgs84(g: Geometry, from: GeoSourceCrs): Geometry {
  if (!GEO_SOURCE_CRS.has(from)) throw new Error(`unsupported source CRS: ${String(from)}`);
  const conv = converter(from);
  return mapPositions(g, (p): Position => {
    const [x, y] = conv ? (conv.forward([p[0], p[1]]) as [number, number]) : [p[0], p[1]];
    return p.length === 3 ? [round7(x), round7(y), p[2]] : [round7(x), round7(y)];
  });
}

/**
 * Reproject WGS84 into `to` (the inverse of `toWgs84`, same definitions): 7 decimals for the
 * geographic CRSs, millimetres for the projected ones. Z passes through unchanged (H1).
 */
export function fromWgs84(g: Geometry, to: GeoSourceCrs): Geometry {
  if (!GEO_SOURCE_CRS.has(to)) throw new Error(`unsupported target CRS: ${String(to)}`);
  const conv = converter(to);
  const round = conv ? (n: number) => Math.round(n * 1e3) / 1e3 : round7;
  return mapPositions(g, (p): Position => {
    const [x, y] = conv ? (conv.inverse([p[0], p[1]]) as [number, number]) : [p[0], p[1]];
    return p.length === 3 ? [round(x), round(y), p[2]] : [round(x), round(y)];
  });
}

/** Detect a likely source CRS from the magnitude of the first position; the user confirms. */
export function guessCrs(g: Geometry): GeoSourceCrs | undefined {
  const first = firstPosition(g);
  if (!first) return undefined;
  const [x, y] = first;
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return 'EPSG:4326';
  if (y < 5.0e6 || y > 6.2e6) return undefined;
  if (x >= 2e5 && x <= 9.5e5) return 'EPSG:25832';
  const zone = Math.floor(x / 1e6);
  const gk = { 2: 'EPSG:31466', 3: 'EPSG:31467', 4: 'EPSG:31468', 5: 'EPSG:31469' } as const;
  return zone in gk ? gk[zone as keyof typeof gk] : undefined;
}
