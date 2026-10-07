import { z } from '../zod';

/** GeoJSON geometry (RFC 7946). Positions may carry a Z coordinate (H1); it is never dropped. */
const Position = z
  .array(z.number())
  .min(2)
  .max(3)
  .describe('[longitude, latitude] or [longitude, latitude, altitude] in WGS84.');
const Line = z.array(Position).min(2);
const Ring = z.array(Position).min(4);
const Bbox = z.array(z.number()).min(4).max(6).optional();

const kind = <T extends string>(t: T) => z.literal(t);

export const GeoJsonGeometrySchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: kind('Point'), coordinates: Position, bbox: Bbox }),
    z.strictObject({ type: kind('MultiPoint'), coordinates: z.array(Position), bbox: Bbox }),
    z.strictObject({ type: kind('LineString'), coordinates: Line, bbox: Bbox }),
    z.strictObject({ type: kind('MultiLineString'), coordinates: z.array(Line), bbox: Bbox }),
    z.strictObject({ type: kind('Polygon'), coordinates: z.array(Ring).min(1), bbox: Bbox }),
    z.strictObject({ type: kind('MultiPolygon'), coordinates: z.array(z.array(Ring).min(1)), bbox: Bbox }),
  ])
  .describe('A GeoJSON geometry object (RFC 7946). Coordinates may include Z.');
export type GeoJsonGeometry = z.infer<typeof GeoJsonGeometrySchema>;
