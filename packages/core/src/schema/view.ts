import { z } from '../zod';
import { ASSET_FORMATS, RENDERERS } from '../registry';
import { ExprSchema, JsonSchema, KeySchema, LocalizedStringSchema } from './primitives';

const rendererKeys = RENDERERS.keys as unknown as [string, ...string[]];
const assetFormatKeys = ASSET_FORMATS.keys as unknown as [string, ...string[]];

/** Features of one type, optionally filtered. */
export const ViewSourceSchema = z
  .strictObject({
    type: KeySchema.describe('The feature type key.'),
    filter: ExprSchema.optional().describe(
      'A rule-language filter, always clipped by the compiled permissions.',
    ),
  })
  .describe('What a view selects.');

/** An external asset (3D tiles, scan) shown next to features. Never filtered, never a dataset (H1). */
export const AssetSourceSchema = z
  .strictObject({
    asset: z.string().min(1).describe('A blob prefix or a URL of the asset.'),
    format: z
      .enum(assetFormatKeys)
      .optional()
      .describe('The asset format, from the registry; absent means the renderer decides.'),
  })
  .describe('An external asset shown next to features.');

export const LayerSourceSchema = z
  .union([ViewSourceSchema, AssetSourceSchema])
  .describe('A feature source (type, optional filter) or an external asset.');

const finite = z.number().finite();

/** The initial camera of a view; Z is metres above the ellipsoid. */
export const CameraSchema = z
  .strictObject({
    center: z
      .array(finite)
      .min(2)
      .max(3)
      .superRefine((c, ctx) => {
        const [lon, lat] = c;
        if (lon !== undefined && Math.abs(lon) > 180)
          ctx.addIssue({ code: 'custom', path: [0], message: 'longitude must be within [-180, 180]' });
        if (lat !== undefined && Math.abs(lat) > 90)
          ctx.addIssue({ code: 'custom', path: [1], message: 'latitude must be within [-90, 90]' });
      })
      .describe('[lon, lat] or [lon, lat, z].'),
    zoom: finite.min(0).max(24).optional().describe('Map zoom level.'),
    pitch: finite.min(0).max(85).optional().describe('Degrees from straight down.'),
    bearing: finite.min(-360).max(360).optional().describe('Degrees clockwise from north.'),
  })
  .describe('The initial camera of a view.');

export const LayerSchema = z
  .strictObject({
    source: LayerSourceSchema.optional().describe(
      'Overrides the view source for this layer: features or an external asset.',
    ),
    renderer: z
      .enum(rendererKeys)
      .describe('The renderer, from the registry (H1). The style format belongs to it.'),
    style: z
      .union([
        z.strictObject({ $ref: z.string().min(1).describe('Path of a style file.') }),
        z.record(z.string(), JsonSchema),
      ])
      .optional()
      .describe(
        'A renderer-specific style: an object (MapLibre Style Spec for maplibre-2d) or { $ref: path }.',
      ),
  })
  .describe('The visual presentation of a view on the map. Never a dataset.');

/** A view: filter, sort, properties and style. Usable standalone for ephemeral views (H4). */
export const ViewSchema = z
  .strictObject({
    label: LocalizedStringSchema.optional().describe('The name shown to participants.'),
    source: ViewSourceSchema,
    camera: CameraSchema.optional(),
    sort: z
      .array(z.string().min(1))
      .optional()
      .describe('Property keys to sort by; a leading "-" sorts descending.'),
    properties: z
      .array(KeySchema)
      .optional()
      .describe('Property keys the view carries; absent means all allowed.'),
    layers: z.record(KeySchema, LayerSchema).optional().describe('Map layers by key.'),
  })
  .describe(
    'A view: filter, sort, properties and style. Drives map layers, lists, exports, the API and the sync scope.',
  );
export type View = z.infer<typeof ViewSchema>;
