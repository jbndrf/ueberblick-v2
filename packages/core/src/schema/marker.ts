/**
 * The look of a feature of one type on the map (WP-674, B-018, v3's per-value icons): `marker` (the type's own
 * icon and colour, v3 `icon_config` and `marker_color`) and `classify` (one select property whose values each get a
 * colour and an icon, v3 `filter_value_icons`). Also the one SVG check and the one resolution chain (R1).
 */
import { z } from '../zod';
import { MARKER_ICON_SIZE, MARKER_ICONS } from '../registry';
import { KeySchema, OptionKeySchema } from './primitives';

const iconKeys = MARKER_ICONS.keys as unknown as [string, ...string[]];

const size = z
  .number()
  .int()
  .min(MARKER_ICON_SIZE.min)
  .max(MARKER_ICON_SIZE.max)
  .optional()
  .describe(
    `Icon size in px (${MARKER_ICON_SIZE.min} to ${MARKER_ICON_SIZE.max}, default ${MARKER_ICON_SIZE.default}).`,
  );

/** A marker icon: a registry key, an inline SVG, or a bundle file that ingestion embeds as an inline SVG (B-013). */
export const MarkerIconSchema = z
  .union([
    z.strictObject({ key: z.enum(iconKeys).describe('An icon of the registry MARKER_ICONS.'), size }),
    z.strictObject({ svg: z.string().min(1).describe('An inline SVG (checked by `checkMarkerSvg`).'), size }),
    z.strictObject({ $ref: z.string().min(1).describe('Path of an SVG file of the project bundle.'), size }),
  ])
  .describe('A marker icon: { key }, { svg } or { $ref }, with an optional size.');
export type MarkerIconConfig = z.infer<typeof MarkerIconSchema>;

export const MarkerColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'a colour as #rrggbb')
  .describe('A colour as #rrggbb.');

export const MarkerAppearanceSchema = z
  .strictObject({
    color: MarkerColorSchema.optional().describe(
      'The colour of the marker, of the dot, and of a line or polygon.',
    ),
    icon: MarkerIconSchema.optional().describe('The icon drawn on the map; absent draws a dot.'),
  })
  .describe('How a feature looks on the map: a colour and an icon.');
export type MarkerAppearance = z.infer<typeof MarkerAppearanceSchema>;

export const ClassifySchema = z
  .strictObject({
    property: KeySchema.describe(
      'The key of the `select` property whose value picks the look (the stage property is one).',
    ),
    values: z
      .record(OptionKeySchema, MarkerAppearanceSchema)
      .describe('Option key to its look; every key is an option of the property.'),
  })
  .describe(
    'The classifying property of a feature type: one select property, and a colour and icon per value.',
  );
export type Classify = z.infer<typeof ClassifySchema>;
