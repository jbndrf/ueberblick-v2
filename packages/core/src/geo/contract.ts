/**
 * core.geo contract (docs/09-standards.md, decision 0013, research/std-02-gis.md §3).
 * CONTRACT — written by the lead; changes need the lead.
 *
 * - Storage is RFC 7946 WGS84 lon/lat. Every position may carry Z; nothing here drops it (H1).
 *   Derived 2D values (bbox, area, length, point-on-surface) ignore Z; a derived point keeps the
 *   Z of the input only where the input defines one unambiguously (a Point); otherwise it has none.
 * - Predicates come from a vetted engine (JSTS or GEOS-wasm, O6), never hand-written. The engine
 *   sits behind `GeoEngine`, so it stays swappable. Loading it may be async; calls are sync.
 * - Pure: no I/O, no clock, no randomness (R2).
 */
import type { GeoPredicate, GeoSourceCrs, GeoValidityIssue } from '../registry';

/** [lon, lat] or [lon, lat, z]; z in metres (RFC 7946 §3.1.1). In a source CRS: [x, y(, z)]. */
export type Position = readonly [number, number] | readonly [number, number, number];

export interface Point {
  readonly type: 'Point';
  readonly coordinates: Position;
}
export interface MultiPoint {
  readonly type: 'MultiPoint';
  readonly coordinates: readonly Position[];
}
export interface LineString {
  readonly type: 'LineString';
  readonly coordinates: readonly Position[];
}
export interface MultiLineString {
  readonly type: 'MultiLineString';
  readonly coordinates: readonly (readonly Position[])[];
}
export interface Polygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly Position[])[];
}
export interface MultiPolygon {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly Position[])[])[];
}
export interface GeometryCollection {
  readonly type: 'GeometryCollection';
  readonly geometries: readonly Geometry[];
}
export type Geometry =
  Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon | GeometryCollection;

/** [minLon, minLat, maxLon, maxLat] (2D; Z is not part of the bbox). */
export type Bbox = readonly [number, number, number, number];

/** Values the fold stores next to a geometry property (decision 0013). */
export interface Derived {
  readonly bbox: Bbox;
  /** Guaranteed to lie on the geometry (polylabel for polygons); markers and labels use it. */
  readonly pointOnSurface: Point;
  /** Area-weighted centroid for polygons, length-weighted for lines; may lie outside. Analytics only. */
  readonly centroid: Point;
  /** Geodesic, m²; 0 for points and lines. */
  readonly areaM2: number;
  /** Geodesic, m; perimeter for polygons, 0 for points. */
  readonly lengthM: number;
}

export interface ValidityReport {
  readonly valid: boolean;
  readonly issues: readonly { readonly issue: GeoValidityIssue; readonly path: string }[];
}

export type RepairResult =
  | { readonly ok: true; readonly geometry: Geometry; readonly fixed: readonly GeoValidityIssue[] }
  | { readonly ok: false; readonly issues: ValidityReport['issues'] };

/** The swappable predicate backend (O6). Implementations: JSTS, GEOS-wasm. */
export interface GeoEngine {
  readonly name: string;
  test(predicate: GeoPredicate, a: Geometry, b: Geometry): boolean;
  /** ST_MakeValid equivalent. */
  makeValid(g: Geometry): Geometry;
  isValid(g: Geometry): boolean;
}

/** A prebuilt bbox index over many geometries (R*-tree prefilter, then exact engine test). */
export interface SpatialIndex<K> {
  readonly size: number;
  /** Keys whose geometry satisfies `predicate(probe, indexed)`, e.g. `within` for point-in-area. */
  query(predicate: GeoPredicate, probe: Geometry): readonly K[];
  /**
   * The entry with the least `distanceM` to `probe` (0 when they intersect), found by branch and bound over the
   * bbox tree, not by measuring every entry. Ties go to the entry that came first in the source. Z is ignored (H1).
   */
  nearest(probe: Geometry): { readonly key: K; readonly distanceM: number } | undefined;
}

/** The module surface. The fold, plan (derived relations) and import use only this. */
export interface Geo {
  /** Source CRS → WGS84, 7 decimals, Z passed through unchanged. */
  toWgs84(g: Geometry, from: GeoSourceCrs): Geometry;
  /** Detect a likely source CRS from coordinate magnitude; the user confirms (docs/09). */
  guessCrs(g: Geometry): GeoSourceCrs | undefined;
  /** RFC 7946 winding, closed rings, rounding to 7 decimals. Idempotent. */
  normalise(g: Geometry): Geometry;
  validate(g: Geometry): ValidityReport;
  repair(g: Geometry): RepairResult;
  derive(g: Geometry): Derived;
  test(predicate: GeoPredicate, a: Geometry, b: Geometry): boolean;
  /** Shortest geodesic distance in metres (within 0.5 % of ellipsoidal); 0 when they intersect. Z is ignored. Throws on an empty geometry. */
  distanceM(a: Geometry, b: Geometry): number;
  /** `distanceM(a, b) <= metres`. */
  dwithin(a: Geometry, b: Geometry, metres: number): boolean;
  index<K>(entries: Iterable<readonly [K, Geometry]>): SpatialIndex<K>;
}
