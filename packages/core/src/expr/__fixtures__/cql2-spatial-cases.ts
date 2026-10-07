/** Spatial corpus for fromCql2 (WP-109): WKT and GeoJSON geometry literals, incl. Z. */
import { P, PT12, SQ_CEL, SQ_WKT, op, pt, sq, type Cql2Case } from './cql2-cases';

export const CQL2_SPATIAL_CASES: readonly Cql2Case[] = [
  // spatial, WKT and GeoJSON
  {
    name: 'intersects point wkt',
    text: 'S_INTERSECTS(geometry, POINT(36.319836 32.288087))',
    json: op('s_intersects', P('geometry'), pt(36.319836, 32.288087)),
    cel: "intersects(self.geometry, {'type':'Point','coordinates':[36.319836,32.288087]})",
  },
  {
    name: 'intersects point z',
    text: 'S_INTERSECTS(geometry, POINT Z(1 2 3))',
    json: op('s_intersects', P('geometry'), pt(1, 2, 3)),
    cel: "intersects(self.geometry, {'type':'Point','coordinates':[1.0,2.0,3.0]})",
  },
  {
    name: 'intersects point z implicit',
    text: 'S_INTERSECTS(geometry, POINT(1 2 3))',
    json: op('s_intersects', P('geometry'), pt(1, 2, 3)),
    cel: "intersects(self.geometry, {'type':'Point','coordinates':[1.0,2.0,3.0]})",
  },
  {
    name: 'within polygon',
    text: `S_WITHIN(geometry, ${SQ_WKT})`,
    json: op('s_within', P('geometry'), sq),
    cel: `within(self.geometry, ${SQ_CEL})`,
  },
  {
    name: 'contains polygon',
    text: `S_CONTAINS(${SQ_WKT}, geometry)`,
    json: op('s_contains', sq, P('geometry')),
    cel: `contains(${SQ_CEL}, self.geometry)`,
  },
  {
    name: 'touches',
    text: `S_TOUCHES(geometry, ${SQ_WKT})`,
    json: op('s_touches', P('geometry'), sq),
    cel: `touches(self.geometry, ${SQ_CEL})`,
  },
  {
    name: 'disjoint',
    text: `S_DISJOINT(geometry, ${SQ_WKT})`,
    json: op('s_disjoint', P('geometry'), sq),
    cel: `disjoint(self.geometry, ${SQ_CEL})`,
  },
  {
    name: 'linestring',
    text: 'S_INTERSECTS(geometry, LINESTRING(0 0, 1 1, 2 0))',
    json: op('s_intersects', P('geometry'), {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
    }),
    cel: "intersects(self.geometry, {'type':'LineString','coordinates':[[0.0,0.0],[1.0,1.0],[2.0,0.0]]})",
  },
  {
    name: 'linestring z',
    text: 'S_INTERSECTS(geometry, LINESTRING Z(0 0 5, 1 1 6))',
    json: op('s_intersects', P('geometry'), {
      type: 'LineString',
      coordinates: [
        [0, 0, 5],
        [1, 1, 6],
      ],
    }),
    cel: "intersects(self.geometry, {'type':'LineString','coordinates':[[0.0,0.0,5.0],[1.0,1.0,6.0]]})",
  },
  {
    name: 'polygon hole',
    text: 'S_WITHIN(geometry, POLYGON((0 0,9 0,9 9,0 0),(1 1,2 1,2 2,1 1)))',
    json: op('s_within', P('geometry'), {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [9, 0],
          [9, 9],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 1],
        ],
      ],
    }),
    cel: "within(self.geometry, {'type':'Polygon','coordinates':[[[0.0,0.0],[9.0,0.0],[9.0,9.0],[0.0,0.0]],[[1.0,1.0],[2.0,1.0],[2.0,2.0],[1.0,1.0]]]})",
  },
  {
    name: 'multipoint',
    text: 'S_INTERSECTS(geometry, MULTIPOINT((1 2),(3 4)))',
    json: op('s_intersects', P('geometry'), {
      type: 'MultiPoint',
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    }),
    cel: "intersects(self.geometry, {'type':'MultiPoint','coordinates':[[1.0,2.0],[3.0,4.0]]})",
  },
  {
    name: 'multipoint bare',
    text: 'S_INTERSECTS(geometry, MULTIPOINT(1 2, 3 4))',
    json: op('s_intersects', P('geometry'), {
      type: 'MultiPoint',
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    }),
    cel: "intersects(self.geometry, {'type':'MultiPoint','coordinates':[[1.0,2.0],[3.0,4.0]]})",
  },
  {
    name: 'multilinestring',
    text: 'S_INTERSECTS(geometry, MULTILINESTRING((0 0,1 1),(2 2,3 3)))',
    json: op('s_intersects', P('geometry'), {
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ],
    }),
    cel: "intersects(self.geometry, {'type':'MultiLineString','coordinates':[[[0.0,0.0],[1.0,1.0]],[[2.0,2.0],[3.0,3.0]]]})",
  },
  {
    name: 'multipolygon',
    text: 'S_INTERSECTS(geometry, MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5))))',
    json: op('s_intersects', P('geometry'), {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 5],
          ],
        ],
      ],
    }),
    cel: "intersects(self.geometry, {'type':'MultiPolygon','coordinates':[[[[0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,0.0]]],[[[5.0,5.0],[6.0,5.0],[6.0,6.0],[5.0,5.0]]]]})",
  },
  {
    name: 'geometry collection',
    text: 'S_INTERSECTS(geometry, GEOMETRYCOLLECTION(POINT(1 2), LINESTRING(0 0,1 1)))',
    json: op('s_intersects', P('geometry'), {
      type: 'GeometryCollection',
      geometries: [
        pt(1, 2),
        {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
    }),
    cel: `intersects(self.geometry, {'type':'GeometryCollection','geometries':[${PT12},{'type':'LineString','coordinates':[[0.0,0.0],[1.0,1.0]]}]})`,
  },
  {
    name: 'bbox',
    text: 'S_INTERSECTS(geometry, BBOX(0,0,10,10))',
    json: op('s_intersects', P('geometry'), { bbox: [0, 0, 10, 10] }),
    cel: `intersects(self.geometry, ${SQ_CEL})`,
  },
  {
    name: 'envelope',
    text: 'S_INTERSECTS(geometry, ENVELOPE(0,0,10,10))',
    json: op('s_intersects', P('geometry'), sq),
    cel: `intersects(self.geometry, ${SQ_CEL})`,
  },
  {
    name: 'geometry lower case',
    text: 's_intersects(geometry, point(1 2))',
    json: op('s_intersects', P('geometry'), pt(1, 2)),
    cel: `intersects(self.geometry, ${PT12})`,
  },
  {
    name: 'spatial and attribute',
    text: 'S_INTERSECTS(geometry, POINT(1 2)) AND floors > 3',
    json: op('and', op('s_intersects', P('geometry'), pt(1, 2)), op('>', P('floors'), 3)),
    cel: `intersects(self.geometry, ${PT12}) && self.floors > 3`,
  },
  {
    name: 'negative coordinates',
    text: 'S_INTERSECTS(geometry, POINT(-13.5 -2.25))',
    json: op('s_intersects', P('geometry'), pt(-13.5, -2.25)),
    cel: "intersects(self.geometry, {'type':'Point','coordinates':[-13.5,-2.25]})",
  },
  {
    name: 'two geometry properties',
    text: 'S_INTERSECTS(geometry, extent)',
    json: op('s_intersects', P('geometry'), P('extent')),
    cel: 'intersects(self.geometry, self.extent)',
  },
  {
    name: 'not disjoint',
    text: `NOT S_DISJOINT(geometry, ${SQ_WKT})`,
    json: op('not', op('s_disjoint', P('geometry'), sq)),
    cel: `!disjoint(self.geometry, ${SQ_CEL})`,
  },
];
