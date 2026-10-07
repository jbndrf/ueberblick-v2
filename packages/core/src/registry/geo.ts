import { defineRegistry, type KeyOf } from './define';

/** Source CRS accepted on import (docs/09-standards.md, decision 0013). Storage is always WGS84. */
export const GEO_SOURCE_CRS = defineRegistry([
  { key: 'EPSG:4326', description: 'WGS84 lon/lat; the storage CRS (RFC 7946).' },
  { key: 'EPSG:4258', description: 'ETRS89 geographic.' },
  { key: 'EPSG:25832', description: 'ETRS89 / UTM zone 32N; German default (west).' },
  { key: 'EPSG:25833', description: 'ETRS89 / UTM zone 33N; German default (east).' },
  { key: 'EPSG:31466', description: 'DHDN / Gauss-Krüger zone 2.' },
  { key: 'EPSG:31467', description: 'DHDN / Gauss-Krüger zone 3.' },
  { key: 'EPSG:31468', description: 'DHDN / Gauss-Krüger zone 4.' },
  { key: 'EPSG:31469', description: 'DHDN / Gauss-Krüger zone 5.' },
] as const);
export type GeoSourceCrs = KeyOf<typeof GEO_SOURCE_CRS>;

/** RFC 7946 geometry types. */
export const GEO_GEOMETRY_TYPES = defineRegistry([
  { key: 'Point', description: 'One position.' },
  { key: 'MultiPoint', description: 'Several positions.' },
  { key: 'LineString', description: 'Two or more positions.' },
  { key: 'MultiLineString', description: 'Several line strings.' },
  { key: 'Polygon', description: 'An exterior ring (counter-clockwise) and holes (clockwise).' },
  { key: 'MultiPolygon', description: 'Several polygons.' },
  { key: 'GeometryCollection', description: 'Mixed geometries; accepted, discouraged.' },
] as const);
export type GeoGeometryType = KeyOf<typeof GEO_GEOMETRY_TYPES>;

/** OGC Simple Features predicates (DE-9IM boundary semantics), from the vetted engine (O6). */
export const GEO_PREDICATES = defineRegistry([
  { key: 'intersects', description: 'Share at least one point, boundary included.' },
  { key: 'disjoint', description: 'Share no point.' },
  { key: 'within', description: "A lies in B; A on B's boundary only is not within." },
  { key: 'contains', description: 'B lies in A (inverse of within).' },
  { key: 'covers', description: 'No point of B lies outside A; boundary counts.' },
  { key: 'coveredBy', description: 'No point of A lies outside B; boundary counts.' },
  { key: 'touches', description: 'Share boundary points only.' },
  { key: 'crosses', description: 'Interiors intersect with lower dimension.' },
  { key: 'overlaps', description: 'Same dimension, interiors intersect, neither contains the other.' },
  { key: 'equals', description: 'Topologically equal.' },
] as const);
export type GeoPredicate = KeyOf<typeof GEO_PREDICATES>;

/** Why a geometry is invalid; reported to the user on import (std-02 §3). */
export const GEO_VALIDITY_ISSUES = defineRegistry([
  { key: 'empty', description: 'No coordinates.' },
  { key: 'non_finite', description: 'NaN or infinite coordinate.' },
  { key: 'out_of_range', description: 'Longitude outside ±180 or latitude outside ±90 after reprojection.' },
  { key: 'too_few_points', description: 'Line with < 2 positions or ring with < 4.' },
  { key: 'ring_not_closed', description: 'First and last ring positions differ.' },
  { key: 'self_intersection', description: 'A ring or line crosses itself.' },
  { key: 'hole_outside_shell', description: 'A hole is not inside its exterior ring.' },
  { key: 'nested_shells', description: 'Multipolygon members overlap.' },
  { key: 'wrong_winding', description: 'Ring orientation not RFC 7946; fixed silently by normalise.' },
] as const);
export type GeoValidityIssue = KeyOf<typeof GEO_VALIDITY_ISSUES>;
