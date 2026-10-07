// The pure part of drawing on the map: parts (vertex lists) to a geometry, and the one validity gate. Validity and
// repair are core.geo's (R1); nothing here decides what is valid. No DOM, no clock (R2).
import type { Geo, Geometry, Position, ValidityReport } from '@ueberblick/core/geo';
import type { GeoValidityIssue } from '@ueberblick/core/registry';

/** What can be drawn on the map: a line or an area. A point is placed with the pin (`PinPlacement`). */
export const DRAW_KINDS = ['linestring', 'polygon'] as const;
export type DrawKind = (typeof DRAW_KINDS)[number];

/** Vertices a part needs before it counts (v3 `geometry-draw-tool.svelte:91`: line 2, area 3). */
export const MIN_VERTICES: Readonly<Record<DrawKind, number>> = { linestring: 2, polygon: 3 };

/** One part: a line, or the ring of one area. `closed` is set when the ring was closed on its first vertex. */
export interface Part {
  readonly points: readonly Position[];
  readonly closed: boolean;
}

export type Outcome =
  | { readonly state: 'incomplete' }
  | { readonly state: 'ok'; readonly geometry: Geometry; readonly fixed: readonly GeoValidityIssue[] }
  | { readonly state: 'refused'; readonly issues: ValidityReport['issues'] };

/** The parts that have enough vertices, as v3's Fertig keeps them (`confirm`, :495-498). */
export const committable = (parts: readonly Part[], kind: DrawKind): Part[] =>
  parts.filter((p) => p.points.length >= MIN_VERTICES[kind]);

/**
 * The geometry of the drawn parts, of the type the property declares: a LineString or Polygon of the one part, or with
 * `multi` (a `multilinestring` / `multipolygon` property, owner Q21) a MultiLineString or MultiPolygon of all parts
 * (v3 `confirm`, :496-548, chose by the number of parts; core accepts only the declared type, `form/type.ts`).
 * `undefined` while no part has enough vertices, or when a single-part type has several. Not yet validated.
 */
export function buildGeometry(parts: readonly Part[], kind: DrawKind, multi: boolean): Geometry | undefined {
  const valid = committable(parts, kind);
  const first = valid[0];
  if (first === undefined || (!multi && valid.length > 1)) return undefined;
  const ring = (p: Part): Position[] => [...p.points, p.points[0] as Position];
  if (kind === 'linestring') {
    return multi
      ? { type: 'MultiLineString', coordinates: valid.map((p) => p.points) }
      : { type: 'LineString', coordinates: first.points };
  }
  return multi
    ? { type: 'MultiPolygon', coordinates: valid.map((p) => [ring(p)]) }
    : { type: 'Polygon', coordinates: [ring(first)] };
}

/**
 * The one gate between the drawing and the stored geometry. core.geo validates and repairs (orientation, closing,
 * rounding). A repair that changes the geometry type (a bow-tie polygon becomes a multipolygon) is a refusal: the
 * property has one geometry type, and silently splitting the person's shape would not be what they drew.
 */
const members = (g: Geometry): number =>
  g.type === 'MultiPolygon' || g.type === 'MultiLineString' ? g.coordinates.length : 1;

export function evaluate(geo: Geo, parts: readonly Part[], kind: DrawKind, multi: boolean): Outcome {
  const built = buildGeometry(parts, kind, multi);
  if (built === undefined) return { state: 'incomplete' };
  const repaired = geo.repair(built);
  if (!repaired.ok) return { state: 'refused', issues: repaired.issues };
  if (repaired.geometry.type !== built.type || members(repaired.geometry) !== members(built)) {
    const issues = geo.validate(built).issues;
    return {
      state: 'refused',
      issues: issues.length > 0 ? issues : [{ issue: 'self_intersection', path: '' }],
    };
  }
  return { state: 'ok', geometry: repaired.geometry, fixed: repaired.fixed };
}

/**
 * The parts of a stored geometry, the inverse of `buildGeometry`: a shape that is loaded to be redrawn (v3 loads the
 * current geometry into the draw tool, `geometry-draw-tool.svelte`). A ring loses its closing position and comes back
 * `closed`. A geometry of another kind gives no parts.
 */
export function partsOf(geometry: Geometry | undefined, kind: DrawKind): Part[] {
  if (geometry === undefined) return [];
  const ring = (r: readonly Position[]): Part => ({ points: r.slice(0, -1), closed: true });
  if (kind === 'linestring') {
    if (geometry.type === 'LineString') return [{ points: geometry.coordinates, closed: false }];
    if (geometry.type === 'MultiLineString')
      return geometry.coordinates.map((points) => ({ points, closed: false }));
    return [];
  }
  if (geometry.type === 'Polygon') return [ring(geometry.coordinates[0] ?? [])];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => ring(poly[0] ?? []));
  return [];
}
