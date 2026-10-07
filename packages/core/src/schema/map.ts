import { z } from '../zod';
import { MAP_LAYER_KINDS, MAP_PRESETS, MAP_SOURCE_TYPES, type MapSourceType } from '../registry';
import { JsonSchema, KeySchema, LocalizedStringSchema } from './primitives';
import { CameraSchema } from './view';

/** An http(s) URL, or a path on the project's own server. `{z}`-style placeholders are allowed. */
const UrlSchema = z
  .string()
  .refine((u) => {
    if (u.startsWith('/') && !u.startsWith('//')) return true;
    try {
      const { protocol } = new URL(u);
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }, 'an http(s) URL or a path starting with /')
  .describe('An http(s) URL or a path on this server.');

const TILE_PLACEHOLDERS = ['{z}', '{x}', '{y}'];

/** One shape per registered source type. A new type is a registry entry plus a shape here (H1, H6). */
const SOURCE_SHAPES: Record<MapSourceType, z.ZodType<unknown>> = {
  xyz: z.strictObject({
    type: z.literal('xyz'),
    url: UrlSchema.refine(
      (u) => TILE_PLACEHOLDERS.every((p) => u.includes(p)),
      'a tile URL template containing {z}, {x} and {y}',
    ),
    tile_size: z
      .union([z.literal(256), z.literal(512)])
      .optional()
      .describe('Tile edge in pixels (default 256).'),
  }),
  wms: z.strictObject({
    type: z.literal('wms'),
    url: UrlSchema.describe('The WMS endpoint, without query parameters.'),
    layers: z.string().min(1).describe('Comma-separated WMS layer names.'),
    version: z.enum(['1.1.1', '1.3.0']).optional().describe('WMS version (default 1.3.0).'),
    format: z.string().min(1).optional().describe('Image format (default image/png).'),
    transparent: z.boolean().optional().describe('Request transparent tiles (default true).'),
  }),
  geojson: z.strictObject({ type: z.literal('geojson'), url: UrlSchema }),
  pmtiles: z.strictObject({
    type: z.literal('pmtiles'),
    url: UrlSchema,
    tile_type: z.enum(['raster', 'vector']).optional().describe('What the archive holds (default raster).'),
    source_layer: z
      .string()
      .min(1)
      .optional()
      .describe('The vector layer to draw; required for vector archives.'),
  }),
  preset: z.strictObject({
    type: z.literal('preset'),
    preset: z
      .enum(MAP_PRESETS.keys as unknown as [string, ...string[]])
      .describe('A key of the preset registry.'),
  }),
};

export const MapSourceSchema = z
  .looseObject({
    type: z
      .enum(MAP_SOURCE_TYPES.keys as unknown as [string, ...string[]])
      .describe('The source type, from the registry.'),
  })
  .superRefine((value, ctx) => {
    const parsed = SOURCE_SHAPES[value.type as MapSourceType].safeParse(value);
    if (parsed.success) {
      const v = value as { type: string; tile_type?: string; source_layer?: string };
      if (v.type === 'pmtiles' && v.tile_type === 'vector' && v.source_layer === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['source_layer'],
          message: 'a vector archive needs source_layer',
        });
      return;
    }
    for (const issue of parsed.error.issues)
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  })
  .describe('Where a map layer gets its data; the keys depend on `type` (registry MAP_SOURCE_TYPES).');
export type MapSource = z.infer<typeof MapSourceSchema>;

const zoom = z.number().min(0).max(24);

export const MapLayerSchema = z
  .strictObject({
    label: LocalizedStringSchema.describe('The name in the layer sheet.'),
    kind: z.enum(MAP_LAYER_KINDS.keys as unknown as [string, ...string[]]).describe('Base or overlay.'),
    source: MapSourceSchema,
    attribution: z.string().optional().describe('Credit line shown on the map; presets bring their own.'),
    opacity: z.number().min(0).max(1).optional().describe('0 to 1 (default 1).'),
    minzoom: zoom.optional().describe('Lowest zoom at which the layer is drawn.'),
    maxzoom: zoom.optional().describe('Highest zoom at which the layer is drawn.'),
    roles: z.array(KeySchema).optional().describe('Role keys that see the layer; absent means every role.'),
    on_at_start: z.boolean().optional().describe('On when a participant first opens the map.'),
    advanced: z
      .strictObject({
        paint: z.record(z.string(), JsonSchema).optional().describe('Style Spec paint properties.'),
        layout: z.record(z.string(), JsonSchema).optional().describe('Style Spec layout properties.'),
      })
      .optional()
      .describe('MapLibre Style Spec paint and layout properties of the layer, checked by the Style Spec.'),
  })
  .describe('A map background layer: a base map or an overlay.');
export type MapLayer = z.infer<typeof MapLayerSchema>;

const BoundsSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .describe('[west, south, east, north] in WGS84 degrees; the checker reports a box that is not valid.');

/** An offline pack (A-032): a region of the map layers that devices download. */
export const MapPackSchema = z
  .strictObject({
    label: LocalizedStringSchema.describe('The name in the offline settings.'),
    bounds: BoundsSchema,
    min_zoom: z.number().int().describe('Lowest zoom level in the pack.'),
    max_zoom: z.number().int().describe('Highest zoom level in the pack.'),
    layers: z.array(KeySchema).min(1).describe('Keys of `map.layers` the pack holds, one file each.'),
    roles: z
      .array(KeySchema)
      .optional()
      .describe('Role keys that get the pack; absent means everyone who sees the layers.'),
  })
  .describe('One offline pack.');
export type MapPack = z.infer<typeof MapPackSchema>;

export const MapSchema = z
  .strictObject({
    start: CameraSchema.pick({ center: true, zoom: true }).optional().describe('Where the map opens.'),
    min_zoom: z.number().int().min(0).max(24).optional().describe('Lowest zoom the map allows (A-036).'),
    max_zoom: z.number().int().min(0).max(24).optional().describe('Highest zoom the map allows (A-036).'),
    layers: z
      .record(KeySchema, MapLayerSchema)
      .describe('Background layers by key; authored order is the draw order.'),
    packs: z
      .record(KeySchema, MapPackSchema)
      .optional()
      .describe('Offline packs by key: regions of the layers that devices download (A-032).'),
    order: z
      .array(KeySchema)
      .optional()
      .describe('Layer keys in draw order, first is lowest; overrides authored order.'),
  })
  .superRefine((map, ctx) => {
    const { min_zoom: lo, max_zoom: hi, start } = map;
    if (lo !== undefined && hi !== undefined && lo > hi)
      ctx.addIssue({ code: 'custom', path: ['min_zoom'], message: 'min_zoom must not exceed max_zoom' });
    if (lo !== undefined && start?.zoom !== undefined && start.zoom < lo)
      ctx.addIssue({ code: 'custom', path: ['start', 'zoom'], message: 'the start zoom is below min_zoom' });
    if (hi !== undefined && start?.zoom !== undefined && start.zoom > hi)
      ctx.addIssue({ code: 'custom', path: ['start', 'zoom'], message: 'the start zoom is above max_zoom' });
    map.order?.forEach((key, i) => {
      if (!(key in map.layers))
        ctx.addIssue({
          code: 'custom',
          path: ['order', i],
          message: `order names ${key}, which is not a layer`,
        });
    });
  })
  .describe('The map backgrounds of the project and where the map opens.');
export type MapConfig = z.infer<typeof MapSchema>;
