/**
 * The JSTS implementation of `GeoEngine` (O6 default, see docs/09-standards.md). JSTS is a pure JS port
 * of JTS, so it runs on device, server, builder and in tests unchanged. Everything JSTS-specific stays in this file.
 */
// JSTS attaches the relate/overlay methods (intersects, union, ...) to Geometry in this module.
import 'jsts/org/locationtech/jts/monkey.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import IndexedPointInAreaLocator from 'jsts/org/locationtech/jts/algorithm/locate/IndexedPointInAreaLocator.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import type { GeoEngine, Geometry, Position } from './contract';
import type { GeoPredicate } from '../registry';
import { at } from './coords';

/** The slice of a JTS geometry this file uses. JSTS ships loose types, so the surface is narrowed here. */
interface Jts {
  getGeometryType(): string;
  getCoordinates(): { x: number; y: number; z: number }[];
  getNumGeometries(): number;
  getGeometryN(i: number): Jts;
  getExteriorRing(): Jts;
  getNumInteriorRing(): number;
  getInteriorRingN(i: number): Jts;
  isEmpty(): boolean;
  union(): Jts;
  difference(other: Jts): Jts;
  [method: string]: unknown;
}
interface Locator {
  locate(p: unknown): number;
}
type JtsMethod = (this: Jts, other: Jts) => boolean;

const factory = new GeometryFactory();
const reader = new GeoJSONReader(factory);

/** Names of the JTS relate methods per registry predicate (`equals` is `equalsTopo` in JSTS). */
const METHOD: Record<GeoPredicate, string> = {
  intersects: 'intersects',
  disjoint: 'disjoint',
  within: 'within',
  contains: 'contains',
  covers: 'covers',
  coveredBy: 'coveredBy',
  touches: 'touches',
  crosses: 'crosses',
  overlaps: 'overlaps',
  equals: 'equalsTopo',
};

/** JTS `Location` values returned by the indexed point-in-area locator. */
const INTERIOR = 0;
const EXTERIOR = 2;
const BOUNDARY = 1;

/**
 * For a Point against an area, the answer follows from where the point lies (interior, boundary, exterior).
 * `pointFirst` is for test(pred, point, area), `areaFirst` for test(pred, area, point). Absent: general path.
 */
type ByLocation = (loc: number) => boolean;
const ANYWHERE: Record<'intersects' | 'disjoint' | 'touches', ByLocation> = {
  intersects: (l) => l !== EXTERIOR,
  disjoint: (l) => l === EXTERIOR,
  touches: (l) => l === BOUNDARY,
};
const POINT_FIRST: Partial<Record<GeoPredicate, ByLocation>> = {
  ...ANYWHERE,
  within: (l) => l === INTERIOR,
  coveredBy: (l) => l !== EXTERIOR,
};
const AREA_FIRST: Partial<Record<GeoPredicate, ByLocation>> = {
  ...ANYWHERE,
  contains: (l) => l === INTERIOR,
  covers: (l) => l !== EXTERIOR,
};

const isAreal = (g: Geometry) => g.type === 'Polygon' || g.type === 'MultiPolygon';

export interface JstsEngineOptions {
  /** Index polygons for point-vs-area tests (default on). Off gives the plain relate path for cross-checks. */
  readonly prepared?: boolean;
}

export function createJstsEngine(options: JstsEngineOptions = {}): GeoEngine {
  const usePrepared = options.prepared ?? true;
  const parsed = new WeakMap<Geometry, Jts>();
  const locators = new WeakMap<Geometry, Locator>();

  const toJts = (g: Geometry): Jts => {
    let j = parsed.get(g);
    if (!j) {
      j = reader.read(g) as Jts;
      parsed.set(g, j);
    }
    return j;
  };

  const locate = (area: Geometry, point: Geometry): number => {
    let l = locators.get(area);
    if (!l) {
      l = new IndexedPointInAreaLocator(toJts(area)) as unknown as Locator;
      locators.set(area, l);
    }
    return l.locate(toJts(point).getCoordinates()[0]);
  };

  const test = (predicate: GeoPredicate, a: Geometry, b: Geometry): boolean => {
    if (usePrepared) {
      if (a.type === 'Point' && isAreal(b)) {
        const f = POINT_FIRST[predicate];
        if (f) return f(locate(b, a));
      } else if (isAreal(a) && b.type === 'Point') {
        const f = AREA_FIRST[predicate];
        if (f) return f(locate(a, b));
      }
    }
    const method = toJts(a)[METHOD[predicate]] as JtsMethod;
    return method.call(toJts(a), toJts(b));
  };

  return {
    name: usePrepared ? 'jsts' : 'jsts-plain',
    test,
    isValid: (g) => IsValidOp.isValid(toJts(g)),
    makeValid: (g) => fromJts(fix(toJts(g))),
  };
}

export const jstsEngine: GeoEngine = createJstsEngine();

const dissolve = (parts: Jts[]): Jts => (factory.createGeometryCollection(parts) as unknown as Jts).union();

/** Polygonize a ring's noded linework and fill every face it encloses (both lobes of a bowtie). */
function fillRing(ring: Jts): Jts | undefined {
  const pz = new Polygonizer();
  // A plain line string, not a LinearRing: unioning one node-splits it at its own crossings.
  pz.add(factory.createLineString(ring.getCoordinates()).union());
  const faces = (pz.getPolygons() as { toArray(): Jts[] }).toArray();
  if (faces.length === 0) return undefined;
  return dissolve(faces);
}

function fixPolygon(poly: Jts): Jts {
  const shell = fillRing(poly.getExteriorRing());
  if (!shell) return factory.createPolygon() as unknown as Jts;
  let out = shell;
  for (let i = 0; i < poly.getNumInteriorRing(); i++) {
    const hole = fillRing(poly.getInteriorRingN(i));
    if (hole) out = out.difference(hole);
  }
  return out;
}

/** ST_MakeValid for areas: node the rings, fill the faces, cut the holes, dissolve overlaps. */
function fix(g: Jts): Jts {
  const type = g.getGeometryType();
  if (type === 'Polygon') return fixPolygon(g);
  if (type === 'MultiPolygon') {
    const parts: Jts[] = [];
    for (let i = 0; i < g.getNumGeometries(); i++) parts.push(fixPolygon(g.getGeometryN(i)));
    return dissolve(parts);
  }
  return g;
}

const pos = (c: { x: number; y: number; z: number }): Position =>
  Number.isFinite(c.z) ? [c.x, c.y, c.z] : [c.x, c.y];

function ring(r: Jts): Position[] {
  return r.getCoordinates().map(pos);
}

function polygon(p: Jts): Position[][] {
  const rings = [ring(p.getExteriorRing())];
  for (let i = 0; i < p.getNumInteriorRing(); i++) rings.push(ring(p.getInteriorRingN(i)));
  return rings;
}

/** JTS to GeoJSON. A position without a finite Z (a new node from noding) is written without one. */
function fromJts(g: Jts): Geometry {
  switch (g.getGeometryType()) {
    case 'Point':
      return g.isEmpty()
        ? { type: 'GeometryCollection', geometries: [] }
        : { type: 'Point', coordinates: pos(at(g.getCoordinates(), 0)) };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: g.getCoordinates().map(pos) };
    case 'LineString':
    case 'LinearRing':
      return { type: 'LineString', coordinates: ring(g) };
    case 'Polygon':
      return g.isEmpty()
        ? { type: 'Polygon', coordinates: [] }
        : { type: 'Polygon', coordinates: polygon(g) };
    case 'MultiPolygon': {
      const polys: Position[][][] = [];
      for (let i = 0; i < g.getNumGeometries(); i++) polys.push(polygon(g.getGeometryN(i)));
      return { type: 'MultiPolygon', coordinates: polys };
    }
    case 'MultiLineString': {
      const lines: Position[][] = [];
      for (let i = 0; i < g.getNumGeometries(); i++) lines.push(ring(g.getGeometryN(i)));
      return { type: 'MultiLineString', coordinates: lines };
    }
    default: {
      const members: Geometry[] = [];
      for (let i = 0; i < g.getNumGeometries(); i++) members.push(fromJts(g.getGeometryN(i)));
      return { type: 'GeometryCollection', geometries: members };
    }
  }
}
