/** core.geo: the one geometry module (F11). Everything else asks `Geo`; nothing else touches proj4 or JSTS. */
import type { Geo, GeoEngine, Geometry } from './contract';
import type { GeoPredicate } from '../registry';
import { fromWgs84, guessCrs, toWgs84 } from './crs';
import { derive } from './derive';
import { distanceM } from './distance';
import { jstsEngine } from './engine-jsts';
import { normalise } from './normalise';
import { pointInArea } from './point-in-area';
import { buildIndex } from './spatial-index';
import { repair, validate } from './validate';

export type * from './contract';
export { fromWgs84, toWgs84 };
export * from './tiles';
export { createJstsEngine, jstsEngine, type JstsEngineOptions } from './engine-jsts';

/**
 * Point vs (Multi)Polygon for intersects, within (point first) and contains (area first) without the
 * engine; `undefined` sends everything else, and every boundary case, to the engine.
 */
function fastTest(predicate: GeoPredicate, a: Geometry, b: Geometry): boolean | undefined {
  if (predicate === 'intersects') {
    const loc = a.type === 'Point' ? pointInArea(a, b) : pointInArea(b, a);
    return loc === undefined ? undefined : loc === 'interior';
  }
  if (predicate === 'within') {
    const loc = pointInArea(a, b);
    return loc === undefined ? undefined : loc === 'interior';
  }
  if (predicate === 'contains') {
    const loc = pointInArea(b, a);
    return loc === undefined ? undefined : loc === 'interior';
  }
  return undefined;
}

/** Build the module around a predicate engine (JSTS by default; O6 keeps GEOS-wasm possible). */
export function createGeo(engine: GeoEngine = jstsEngine): Geo {
  return {
    toWgs84,
    guessCrs,
    normalise,
    validate: (g) => validate(engine, g),
    repair: (g) => repair(engine, g),
    derive: (g) => derive(engine, g),
    test: (predicate, a, b) => fastTest(predicate, a, b) ?? engine.test(predicate, a, b),
    distanceM: (a, b) => distanceM(engine, a, b),
    dwithin: (a, b, metres) => distanceM(engine, a, b) <= metres,
    index: (entries) => buildIndex(engine, entries),
  };
}
