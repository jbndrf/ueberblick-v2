/** The real seams, over the core exports of WP-568: CQL2 reading with the type's check environment, and CRS transforms. */
import { GEO_SOURCE_CRS, type Bbox, type GeoSourceCrs, type Geometry } from '@ueberblick/core';
import { checkEnvFor } from '@ueberblick/core/compile';
import { bboxOf } from '@ueberblick/core/geo/bbox';
import { fromWgs84, toWgs84 } from '@ueberblick/core/geo';
import { check, fromCql2, T } from '@ueberblick/core/expr/compile';
import { CRS84, EPSG_4326, swapAxes, type Cql2Seam, type CrsSeam } from './seams';

/** Projected CRSs of the core registry, by their OGC URI (`.../EPSG/0/25832`). EPSG:4326 is served lat/lon, apart. */
const PROJECTED = new Map<string, GeoSourceCrs>();
for (const key of GEO_SOURCE_CRS.keys as readonly GeoSourceCrs[]) {
  const m = /^EPSG:(\d+)$/.exec(key);
  if (m !== null && key !== 'EPSG:4326' && key !== 'EPSG:4258')
    PROJECTED.set(`http://www.opengis.net/def/crs/EPSG/0/${m[1]}`, key);
}

const keyOf = (crs: string): GeoSourceCrs => {
  const key = PROJECTED.get(crs);
  if (key === undefined) throw new Error(`CRS ${crs} is not supported`);
  return key;
};

export const coreCrs: CrsSeam = {
  supported: [CRS84, EPSG_4326, ...PROJECTED.keys()],
  fromWgs84: (g, crs) => {
    if (crs === CRS84) return g;
    return crs === EPSG_4326 ? swapAxes(g) : fromWgs84(g, keyOf(crs));
  },
  toWgs84: (g, crs) => {
    if (crs === CRS84) return g;
    return crs === EPSG_4326 ? swapAxes(g) : toWgs84(g, keyOf(crs));
  },
  bboxToWgs84(b, crs) {
    if (crs === CRS84) return b;
    if (crs === EPSG_4326) return [b[1], b[0], b[3], b[2]];
    const ring: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [b[0], b[1]],
          [b[2], b[1]],
          [b[2], b[3]],
          [b[0], b[3]],
          [b[0], b[1]],
        ],
      ],
    };
    return (bboxOf(toWgs84(ring, keyOf(crs))) ?? b) as Bbox;
  },
};

export const coreCql2: Cql2Seam = {
  read(config, type, filter) {
    const parsed = fromCql2(filter);
    if (!parsed.ok)
      return { ok: false, message: parsed.errors[0]?.message ?? 'The filter could not be read.' };
    const env = checkEnvFor(config, type);
    if (!env.ok) return { ok: false, message: `No collection '${env.error.type}'.` };
    const checked = check(parsed.ast, env.env, { expect: T.bool });
    return checked.ok
      ? { ok: true, typed: checked.typed }
      : { ok: false, message: checked.errors[0]?.message ?? 'The filter does not fit the collection.' };
  },
};
