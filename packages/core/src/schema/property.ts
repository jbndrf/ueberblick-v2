import { z } from '../zod';
import {
  PROPERTY_TYPES,
  GEOMETRY_TYPES,
  PERSONAL_SUBJECT_KINDS,
  RELATION_CARDINALITIES,
  type PropertyTypeKey,
  type RelationCardinality,
} from '../registry';
import { GeoJsonGeometrySchema } from './geojson';
import { PropertyDisplaySchema } from './property-display';
import { ParticipantSelectSchema } from './property-select';
import { JsonSchema, KeySchema, LocalizedStringSchema, OptionKeySchema, ExprSchema } from './primitives';

/** An `accept` entry: a MIME type, optionally a wildcard subtype (image/*), or a dotted extension (.pdf). */
const ACCEPT_PATTERN = /^([a-z0-9][a-z0-9.+-]*\/([a-z0-9][a-z0-9.+-]*|\*)|\.[a-z0-9]+)$/i;

const typeKeys = PROPERTY_TYPES.keys as unknown as [PropertyTypeKey, ...PropertyTypeKey[]];

const cardinalityKeys = RELATION_CARDINALITIES.keys as unknown as [
  RelationCardinality,
  ...RelationCardinality[],
];

const geometryKeys = GEOMETRY_TYPES.keys as unknown as [string, ...string[]];
export const GeometryTypeSchema = z
  .enum(geometryKeys)
  .describe('The geometry kind of a feature type, from the registry.');

/** `actor`, `feature` or `property:<key>`: the kinds come from the registry. */
export const PersonalSubjectSchema = z
  .string()
  .refine(
    (v) => {
      const [kind, arg, ...rest] = v.split(':');
      if (kind === undefined || !PERSONAL_SUBJECT_KINDS.has(kind) || rest.length > 0) return false;
      return kind === 'property' ? arg !== undefined && KeySchema.safeParse(arg).success : arg === undefined;
    },
    {
      message: `subject must be actor, feature or property:<key> (kinds: ${PERSONAL_SUBJECT_KINDS.keys.join(', ')})`,
    },
  )
  .describe('Whose data this is: actor, feature, or property:<key> naming a participant property.');

/** A property of a feature type (also the shape of a template input). */
export const PropertySchema = z
  .strictObject({
    type: z.enum(typeKeys).describe('The property type, from the property type registry.'),
    label: LocalizedStringSchema.optional().describe('The name shown to participants.'),
    description: LocalizedStringSchema.optional().describe('Help text shown next to the property.'),
    required: z.boolean().optional().describe('Whether a value must exist once the feature is created.'),
    default: JsonSchema.optional().describe('The value a new feature starts with.'),
    computed: ExprSchema.optional().describe(
      'Berechnet: a rule-language expression over `self`. Plan keeps the value up to date, on the device and on the server, whenever an input changes; nobody writes it.',
    ),
    display: PropertyDisplaySchema.optional().describe('How the read view (Daten) shows the property.'),
    index: z.boolean().optional().describe('Ask for a database index so filters and sorts on it stay fast.'),
    personal: z
      .strictObject({ subject: PersonalSubjectSchema })
      .optional()
      .describe('Marks the property as personal data and names whose it is (erasure and export use it).'),
    options: z
      .record(OptionKeySchema, LocalizedStringSchema)
      .optional()
      .describe('select/multiselect: option key to label.'),
    option_hints: z
      .record(OptionKeySchema, LocalizedStringSchema)
      .optional()
      .describe(
        'select/multiselect: option key to the explanation text shown under the option (v3 "Antwort, Erklärungstext").',
      ),
    to: KeySchema.optional().describe('reference: the feature type key that is referenced.'),
    accept: z
      .array(
        z.string().regex(ACCEPT_PATTERN, 'a MIME type (image/*, application/pdf) or an extension (.pdf)'),
      )
      .min(1)
      .optional()
      .describe(
        'file: accepted MIME types (image/*, application/pdf) or extensions (.pdf); absent means any.',
      ),
    max_files: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('file: most files the value may hold (default 10).'),
    select: ParticipantSelectSchema.optional(),
    cardinality: z
      .enum(cardinalityKeys)
      .optional()
      .describe(
        'reference/participant/role: one (default, a single id) or many ("Mehrfachauswahl": a list of ids).',
      ),
    display_property: KeySchema.optional().describe(
      'reference: a property of the target type whose value names the target in pickers and cells ("Anzeigefeld"). Absent: the display name (B-014).',
    ),
    min: z.number().optional().describe('number/integer: smallest allowed value.'),
    max: z.number().optional().describe('number/integer: largest allowed value.'),
    geometry_type: GeometryTypeSchema.optional().describe(
      'geometry: the geometry kind, from the registry; absent means any.',
    ),
  })
  .superRefine((p, ctx) => {
    const entry = PROPERTY_TYPES.get(p.type);
    for (const opt of [
      'options',
      'option_hints',
      'to',
      'accept',
      'max_files',
      'min',
      'max',
      'geometry_type',
      'select',
      'cardinality',
      'display_property',
    ] as const) {
      const present = p[opt] !== undefined;
      if (present && !entry.options.includes(opt)) {
        ctx.addIssue({ code: 'custom', path: [opt], message: `"${opt}" is not allowed on type ${p.type}` });
      }
      if (!present && entry.requires.includes(opt)) {
        ctx.addIssue({ code: 'custom', path: [opt], message: `type ${p.type} requires "${opt}"` });
      }
    }
    for (const k of Object.keys(p.option_hints ?? {})) {
      if (p.options !== undefined && !Object.hasOwn(p.options, k)) {
        ctx.addIssue({
          code: 'custom',
          path: ['option_hints', k],
          message: `option_hints names "${k}", which is not an option`,
        });
      }
    }
    if (p.type === 'geometry' && p.default !== undefined) {
      const r = GeoJsonGeometrySchema.safeParse(p.default);
      if (!r.success) {
        ctx.addIssue({ code: 'custom', path: ['default'], message: 'default is not a GeoJSON geometry' });
      }
    }
  })
  .describe('A property: a value on a feature, addressed by key.');
export type Property = z.infer<typeof PropertySchema>;

export const RelationSchema = z
  .strictObject({
    to: KeySchema.describe('The feature type key on the other side.'),
    label: LocalizedStringSchema.optional().describe(
      'How the feature sheet names this relation (e.g. "Fläche"). Absent: the relation key is shown.',
    ),
    derive: ExprSchema.optional().describe(
      'A rule-language expression that computes the edges; absent means a picked reference.',
    ),
    inverse_of: z
      .string()
      .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'inverse_of is <type>.<relation or reference property>')
      .optional()
      .describe(
        'A read-only reverse set of a reference or relation on `to`, written <type>.<key>. No edge is stored twice.',
      ),
    inherit_position: z
      .boolean()
      .optional()
      .describe(
        'On an inverse_of relation: the children have no position of their own and are drawn at their parent (B-019). The child type then has no primary geometry.',
      ),
    cardinality: z
      .enum(cardinalityKeys)
      .optional()
      .describe('one or many. Default: one for a picked reference, many for derive and inverse_of.'),
  })
  .superRefine((r, ctx) => {
    if (r.derive !== undefined && r.inverse_of !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['inverse_of'],
        message: 'a relation is derived or an inverse, not both',
      });
    }
    if (r.inherit_position !== undefined && r.inverse_of === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['inherit_position'],
        message: 'inherit_position belongs on an inverse_of relation: it says where the children are drawn',
      });
    }
    if (r.inverse_of !== undefined && r.inverse_of.split('.')[0] !== r.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['inverse_of'],
        message: 'inverse_of must name a key on the type given in `to`',
      });
    }
  })
  .describe('A relation to another feature type: a reference (picked), derived (computed) or an inverse.');
export type Relation = z.infer<typeof RelationSchema>;
