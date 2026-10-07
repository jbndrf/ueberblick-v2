import { z } from '../zod';
import { AUDIENCES } from '../registry';
import { PropertySchema, RelationSchema } from './property';
import { ClassifySchema, MarkerAppearanceSchema } from './marker';
import { ExprSchema, KeySchema, LocalizedStringSchema } from './primitives';

/** `$all`, or a list of role keys. Anything not allowed is denied (F6). */
export const AudienceSchema = z
  .union([z.enum(AUDIENCES.keys as unknown as [string, ...string[]]), z.array(KeySchema)])
  .describe('Who: "$all" or a list of role keys.');

const perProperty = z.record(KeySchema, AudienceSchema).describe('Property key to audience.');

export const PermissionsSchema = z
  .strictObject({
    see: z
      .union([AudienceSchema, perProperty])
      .optional()
      .describe(
        'Roles that may see features of this type: one audience for all, or property key to audience (properties not listed stay visible to every role that sees the feature).',
      ),
    visible_when: ExprSchema.optional().describe(
      'Row-level filter: a feature is visible only while this is true (e.g. self.melder == actor.id). Compiled to SQL; `see` stays an audience.',
    ),
    create: AudienceSchema.optional().describe('Roles that may create features of this type.'),
    delete: AudienceSchema.optional().describe('Roles that may delete features of this type.'),
    write: z
      .union([AudienceSchema, perProperty])
      .optional()
      .describe('Roles that may change properties: one audience for all, or property key to audience.'),
  })
  .describe(
    'Permissions of one feature type. Compiled into one SQL predicate, an allowlist and a planner check.',
  );

/** The one process of a feature type: which `select` property is the stage, where features start, where they end. */
export const ProcessDeclSchema = z
  .strictObject({
    property: KeySchema.describe('The key of the `select` property that holds the stage.'),
    start: KeySchema.describe(
      'The option a new feature of this type starts in (replaces a `default` on the property).',
    ),
    end: z.array(KeySchema).describe('The options that end the process (at least one, never the start).'),
  })
  .describe(
    'The process of the feature type: a stage property with a start and end stages. Only `then.set` steps write the stage.',
  );
export type ProcessDecl = z.infer<typeof ProcessDeclSchema>;

export const FeatureTypeSchema = z
  .strictObject({
    label: LocalizedStringSchema.describe('The name of the feature type shown to participants.'),
    description: LocalizedStringSchema.optional().describe('What this feature type is for.'),
    geometry: KeySchema.optional().describe(
      'The key of the primary geometry property (type geometry); absent means features have no map geometry. The primary geometry is the map geometry of the feature (stored geometry, anchor, area); the spatial index covers every geometry property.',
    ),
    properties: z
      .record(KeySchema, PropertySchema)
      .describe('Properties by key. Stage, geometry and assignee are properties too.'),
    relations: z
      .record(KeySchema, RelationSchema)
      .optional()
      .describe('Relations to other feature types, by key.'),
    process: ProcessDeclSchema.optional(),
    marker: MarkerAppearanceSchema.optional().describe(
      "The type's own look on the map: the fallback for a value with none (v3 icon_config and marker_color).",
    ),
    classify: ClassifySchema.optional(),
    on_at_start: z
      .boolean()
      .optional()
      .describe(
        'False: features of this type are hidden when a participant first opens the map (default true).',
      ),
    values_at_start: z
      .array(z.string())
      .optional()
      .describe(
        'The values of the classifying property (or the stage) that are shown at first; absent means all.',
      ),
    permissions: PermissionsSchema.optional(),
  })
  .superRefine((t, ctx) => {
    if (t.geometry === undefined) return;
    const p = t.properties[t.geometry];
    if (p === undefined || p.type !== 'geometry') {
      ctx.addIssue({
        code: 'custom',
        path: ['geometry'],
        message: `geometry must name a property of type geometry, got "${t.geometry}"`,
      });
    }
  })
  .describe('A feature type: the shape of features (properties, geometry, relations, permissions).');
export type FeatureType = z.infer<typeof FeatureTypeSchema>;
