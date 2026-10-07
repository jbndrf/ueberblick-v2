import { z } from '../zod';
import { SCHEMA_VERSIONS } from '../registry';
import { FeatureTypeSchema } from './feature-type';
import {
  ExprSchema,
  JsonObjectSchema,
  JsonSchema,
  KeyPathSchema,
  KeySchema,
  LocalizedStringSchema,
  SemverSchema,
} from './primitives';
import { PropertySchema } from './property';
import { TaskSchema } from './task';
import { BrandingSchema } from './branding';
import { MapSchema } from './map';
import { ViewSchema } from './view';
import { RoleToolSchema } from './tools';
import { InfoPagesSchema } from './info-pages';

const schemaVersion = z
  .enum(SCHEMA_VERSIONS.keys as unknown as [string, ...string[]])
  .describe('The platform schema version. First line of the file.');

/** A keyed map: single entries can be added or hidden by an overlay (A-005 item 1). */
const keyedMap = z.record(KeySchema, JsonObjectSchema);

/**
 * A filter preset (WP-640): what the admin sets once for a role. `filters` maps a feature type key to a rule-language
 * expression over `self`; the same shape a participant's saved filter has (`SavedFilter` in prefs), plus a label.
 */
export const FilterPresetSchema = z
  .strictObject({
    label: LocalizedStringSchema.describe('The name shown in the filter sheet.'),
    filters: z
      .record(KeySchema, ExprSchema)
      .describe('Feature type key to a rule-language expression over `self`; always clipped by permissions.'),
  })
  .describe('A filter preset: one filter per feature type, offered to a role.');
export type FilterPreset = z.infer<typeof FilterPresetSchema>;

/** The per-role app profile (H3): what one role's app looks like. */
export const RoleAppSchema = z
  .strictObject({
    home: KeySchema.optional().describe('Key of the default view.'),
    views: keyedMap
      .optional()
      .describe('The views this role sees: view key to per-role settings ({}). Order is authored order.'),
    tools: z
      .record(KeySchema, RoleToolSchema)
      .optional()
      .describe('The tools this role has: tool key to availability (offered or active) and role settings.'),
    shortcuts: keyedMap
      .optional()
      .describe('Tasks pinned for one-tap access: task key to per-role settings ({}).'),
    presets: z
      .record(KeySchema, JsonObjectSchema)
      .optional()
      .describe('Named preset values, e.g. default property values.'),
    filter_presets: z
      .record(KeySchema, FilterPresetSchema)
      .optional()
      .describe(
        'Filters this role finds ready in the filter sheet: preset key to label and one filter per type.',
      ),
    ui: JsonObjectSchema.optional().describe('UI options such as theme; the keys belong to the app.'),
    activity_names: z
      .boolean()
      .optional()
      .describe(
        "Whether this role sees who made each change in the activity timeline. Default true. When false, the device gets no actor id and no name for other people's runs.",
      ),
  })
  .describe('What the app looks like for one role.');
export type RoleApp = z.infer<typeof RoleAppSchema>;

export const RoleSchema = z
  .strictObject({
    label: LocalizedStringSchema.describe('The name of the role.'),
    description: LocalizedStringSchema.optional().describe(
      'What the role is for, one short line (shown on the Rollen page).',
    ),
    app: RoleAppSchema.optional(),
    quota: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'The most features a participant with this role may create (all types together; deleting one frees a place). With several roles the highest quota counts. Absent: no limit.',
      ),
  })
  .describe('A role: a permission group within a project, with an optional app profile.');

export const ToolSettingsSchema = JsonObjectSchema.describe(
  'Settings of one tool; its keys belong to the tool.',
);

const migrationStep = z
  .record(KeySchema, JsonSchema)
  .describe('One migration step, e.g. { rename_option: { … } }.');

/** Sections shared by template files and (through `add`) by overlays. */
const sections = {
  roles: z.record(KeySchema, RoleSchema).optional().describe('Roles by key.'),
  types: z.record(KeySchema, FeatureTypeSchema).optional().describe('Feature types by key.'),
  tasks: z.record(KeySchema, TaskSchema).optional().describe('Tasks by key.'),
  views: z.record(KeySchema, ViewSchema).optional().describe('Views by key.'),
  tools: z.record(KeySchema, ToolSettingsSchema).optional().describe('Tool settings by tool key.'),
  map: MapSchema.optional(),
  branding: BrandingSchema.optional(),
  info_pages: InfoPagesSchema.optional(),
};

export const TemplateFileSchema = z
  .strictObject({
    schema: schemaVersion,
    template: z
      .strictObject({
        key: KeySchema.describe('The template key.'),
        version: SemverSchema,
        label: LocalizedStringSchema.optional(),
      })
      .describe('Identity of this template version.'),
    inputs: z
      .record(KeySchema, PropertySchema)
      .optional()
      .describe('Intended customisation points; overlays set values.'),
    lock: z.array(KeyPathSchema).optional().describe('Key paths that an overlay may not touch.'),
    ...sections,
    migrations: z
      .record(z.string().regex(/^\d+ -> \d+$/, 'a major step such as "1 -> 2"'), z.array(migrationStep))
      .optional()
      .describe('Data migrations shipped with major versions, run as system runs.'),
  })
  .describe('A template file: a published, versioned project blueprint.');
export type TemplateFile = z.infer<typeof TemplateFileSchema>;

export const OverlayFileSchema = z
  .strictObject({
    schema: schemaVersion,
    extends: z
      .string()
      .regex(/^[a-z][a-z0-9_]*@\d+(\.\d+){0,2}$/, 'template@major, e.g. baumkataster@1')
      .describe('The template and version range this project builds on, e.g. baumkataster@1.'),
    inputs: z.record(KeySchema, JsonSchema).optional().describe('Values for the template inputs.'),
    override: z.record(KeyPathSchema, JsonSchema).optional().describe('Key path to the new value.'),
    add: z.record(KeyPathSchema, JsonSchema).optional().describe('Key path to a new entity or value.'),
    hide: z.array(KeyPathSchema).optional().describe('Key paths of template elements to hide.'),
    order: z
      .record(KeyPathSchema, z.array(KeySchema))
      .optional()
      .describe('Key path of a map to the keys that come first, in this order; unlisted keys follow.'),
  })
  .describe('An overlay file: what a project adds, overrides, hides or reorders relative to its template.');
export type OverlayFile = z.infer<typeof OverlayFileSchema>;

/** A project file is a template or an overlay. */
export const ProjectFileSchema = z.union([TemplateFileSchema, OverlayFileSchema]);
export type ProjectFile = TemplateFile | OverlayFile;

/**
 * Parse a project file. Picks the branch by its discriminating key (`template` or `extends`) so that
 * error paths point at the real mistake instead of an "invalid union".
 */
export function parseProjectFile(input: unknown) {
  const isOverlay =
    typeof input === 'object' && input !== null && 'extends' in input && !('template' in input);
  return isOverlay ? OverlayFileSchema.safeParse(input) : TemplateFileSchema.safeParse(input);
}
