import { defineRegistry, type KeyOf } from './define';

/** Geometry kinds a feature type may declare (GeoJSON, RFC 7946). */
export const GEOMETRY_TYPES = defineRegistry([
  { key: 'point', description: 'A single position.' },
  { key: 'multipoint', description: 'Several positions.' },
  { key: 'linestring', description: 'A line.' },
  { key: 'multilinestring', description: 'Several lines.' },
  { key: 'polygon', description: 'An area with optional holes.' },
  { key: 'multipolygon', description: 'Several areas.' },
  { key: 'any', description: 'Any geometry kind.' },
] as const);
export type GeometryTypeKey = KeyOf<typeof GEOMETRY_TYPES>;

/** Renderers for view layers (H1). The style format belongs to the renderer. */
export const RENDERERS = defineRegistry([
  { key: 'maplibre-2d', description: 'MapLibre GL 2D map; the style is a MapLibre Style Spec fragment.' },
] as const);
export type RendererKey = KeyOf<typeof RENDERERS>;

/** Formats of external assets a layer can show next to features (H1, B-003). */
export const ASSET_FORMATS = defineRegistry([
  {
    key: '3dtiles',
    description: 'OGC 3D Tiles 1.1 with glTF content (city models, BIM converted ahead of time, scans).',
  },
] as const);
export type AssetFormat = KeyOf<typeof ASSET_FORMATS>;

/** Special `on` targets of a task besides feature type keys. Platform keywords carry the `$` sigil (A-005). */
export const TASK_OFFERS = defineRegistry([
  { key: '$map', description: 'Offered from a map position, without a feature.' },
  { key: '$none', description: 'Not offered in the UI; started by rules or the API only.' },
] as const);
export type TaskOffer = KeyOf<typeof TASK_OFFERS>;

/** Who a permission applies to besides a list of role keys. */
export const AUDIENCES = defineRegistry([
  { key: '$all', description: 'Every role of the project.' },
] as const);
export type Audience = KeyOf<typeof AUDIENCES>;

/** Schema versions the platform understands (`schema: ueberblick/<n>`). */
export const SCHEMA_VERSIONS = defineRegistry([
  { key: 'ueberblick/1', description: 'The first project file format.' },
] as const);
export type SchemaVersion = KeyOf<typeof SCHEMA_VERSIONS>;

/** How many features a relation yields: `one` traverses to a feature, `many` to a set (docs/06). */
export const RELATION_CARDINALITIES = defineRegistry([
  { key: 'one', description: 'At most one related feature; traversal yields a feature.' },
  { key: 'many', description: 'Any number of related features; traversal yields a set.' },
] as const);
export type RelationCardinality = KeyOf<typeof RELATION_CARDINALITIES>;

/**
 * Timings of an automatic action, `tasks.<task>.auto.<name>` (C-004). A timing is at most one key of the entry
 * (`after`, `change`, `elapsed`, `schedule` with its sibling `idle`); `implicit` is no key at all: the entry's own
 * `when` turning true (edge, the default). `server_only` timings never run on a device.
 */
export const AUTO_TIMING_KINDS = defineRegistry([
  { key: 'after', form: 'string', server_only: false, description: 'After a task ran: `after: <task key>`.' },
  {
    key: 'change',
    form: 'string',
    server_only: false,
    description: 'After a property changed: `change: <type>.<property>`.',
  },
  {
    key: 'edge',
    form: 'implicit',
    server_only: false,
    description: 'No timing key: the entry `when` turns false -> true after a run (A-045). The default.',
  },
  {
    key: 'elapsed',
    form: 'object',
    server_only: true,
    description: 'A time span after (or before) a time expression: { from, after?, offset? }.',
  },
  {
    key: 'schedule',
    form: 'string',
    server_only: true,
    description: 'A cron schedule: `schedule: <cron>`, optionally with `idle`.',
  },
] as const);
export type AutoTimingKind = KeyOf<typeof AUTO_TIMING_KINDS>;
