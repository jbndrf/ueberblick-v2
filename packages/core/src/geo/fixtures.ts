/** Fixture corpus for core.geo tests and benchmarks (WGS84 lon/lat around Berlin unless noted). */
import type { Geometry, LineString, MultiPolygon, Point, Polygon } from './contract';
import { at } from './coords';

/** Exterior CCW, closed. Roughly 0.01 deg square near Berlin. */
export const SQUARE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [13.4, 52.5],
      [13.41, 52.5],
      [13.41, 52.51],
      [13.4, 52.51],
      [13.4, 52.5],
    ],
  ],
};

/** SQUARE with Z on every vertex. */
export const SQUARE_Z: Polygon = {
  type: 'Polygon',
  coordinates: [at(SQUARE.coordinates, 0).map(([x, y], i) => [x, y, 30 + i] as const)],
};

/** SQUARE with a CW hole. */
export const WITH_HOLE: Polygon = {
  type: 'Polygon',
  coordinates: [
    at(SQUARE.coordinates, 0),
    [
      [13.403, 52.503],
      [13.403, 52.507],
      [13.407, 52.507],
      [13.407, 52.503],
      [13.403, 52.503],
    ],
  ],
};

/** Two disjoint squares. */
export const MULTI: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    SQUARE.coordinates,
    [
      [
        [13.5, 52.5],
        [13.51, 52.5],
        [13.51, 52.51],
        [13.5, 52.51],
        [13.5, 52.5],
      ],
    ],
  ],
};

/** A C-shape: its centroid lies outside, so it separates centroid from point-on-surface. */
export const C_SHAPE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0.03, 0],
      [0.03, 0.005],
      [0.005, 0.005],
      [0.005, 0.025],
      [0.03, 0.025],
      [0.03, 0.03],
      [0, 0.03],
      [0, 0],
    ],
  ],
};

/** Self-intersecting ring (bowtie). */
export const BOWTIE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0.01, 0.01],
      [0.01, 0],
      [0, 0.01],
      [0, 0],
    ],
  ],
};

export const UNCLOSED: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
    ],
  ],
};

/** Exterior ring clockwise (RFC 7946 wants counter-clockwise). */
export const CW_EXTERIOR: Polygon = {
  type: 'Polygon',
  coordinates: [[...at(SQUARE.coordinates, 0)].reverse()],
};

export const HOLE_OUTSIDE: Polygon = {
  type: 'Polygon',
  coordinates: [
    at(SQUARE.coordinates, 0),
    [
      [13.5, 52.5],
      [13.5, 52.501],
      [13.501, 52.501],
      [13.501, 52.5],
      [13.5, 52.5],
    ],
  ],
};

/** Two overlapping members. */
export const NESTED_SHELLS: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    SQUARE.coordinates,
    [
      [
        [13.402, 52.502],
        [13.408, 52.502],
        [13.408, 52.508],
        [13.402, 52.508],
        [13.402, 52.502],
      ],
    ],
  ],
};

export const TOO_FEW: LineString = { type: 'LineString', coordinates: [[1, 1]] };
export const NON_FINITE: Point = { type: 'Point', coordinates: [Number.NaN, 1] };
export const EMPTY_LINE: LineString = { type: 'LineString', coordinates: [] };
export const OUT_OF_RANGE: Point = { type: 'Point', coordinates: [200, 10] };

export const PRECISE: Point = { type: 'Point', coordinates: [13.123456789012, 52.987654321098, 41.5] };
export const POINT_Z: Point = { type: 'Point', coordinates: [13.405, 52.505, 34.25] };
export const LINE: LineString = {
  type: 'LineString',
  coordinates: [
    [13.4, 52.5, 10],
    [13.41, 52.5, 20],
    [13.41, 52.51, 30],
  ],
};

/** Points against SQUARE: interior, on the boundary, on a vertex, outside. */
export const PT_INSIDE: Point = { type: 'Point', coordinates: [13.405, 52.505] };
export const PT_ON_EDGE: Point = { type: 'Point', coordinates: [13.405, 52.5] };
export const PT_ON_VERTEX: Point = { type: 'Point', coordinates: [13.4, 52.5] };
export const PT_OUTSIDE: Point = { type: 'Point', coordinates: [13.6, 52.6] };

/**
 * German CRS samples: [crs, x, y, expected lon (exact on the central meridian) or undefined].
 * ETRS89 UTM has its central meridian at x = 500000 (9 or 15 deg east). Gauss-Krueger zones add
 * the zone number in front of a 500000 false easting; DHDN needs a datum shift, so only ETRS89 is exact.
 */
export const CRS_SAMPLES = [
  { crs: 'EPSG:25832', x: 500000, y: 5300000, lon: 9 },
  { crs: 'EPSG:25833', x: 500000, y: 5800000, lon: 15 },
  { crs: 'EPSG:31467', x: 3500000, y: 5800000, lon: undefined },
  { crs: 'EPSG:31466', x: 2500000, y: 5700000, lon: undefined },
  { crs: 'EPSG:31468', x: 4500000, y: 5700000, lon: undefined },
  { crs: 'EPSG:31469', x: 5500000, y: 5700000, lon: undefined },
] as const;

export const ALL_VALID: readonly (readonly [string, Geometry])[] = [
  ['square', SQUARE],
  ['with hole', WITH_HOLE],
  ['multi', MULTI],
  ['c shape', C_SHAPE],
  ['line', LINE],
  ['point', POINT_Z],
];
