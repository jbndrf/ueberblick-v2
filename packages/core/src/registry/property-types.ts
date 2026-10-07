import { defineRegistry, type KeyOf, type RegistryEntry } from './define';

/** A property type: what a property value may be. Registered here, used by the schema (F8). */
export interface PropertyTypeEntry<K extends string = string> extends RegistryEntry<K> {
  /** Type-specific option keys a property of this type may carry. */
  readonly options: readonly string[];
  /** The subset of `options` that is mandatory. */
  readonly requires: readonly string[];
}

/** Identity helper that keeps the literal key while checking the entry shape. */
export function definePropertyType<const K extends string>(
  entry: PropertyTypeEntry<K>,
): PropertyTypeEntry<K> {
  return entry;
}

const NONE: readonly string[] = [];

/** Property types (docs/01-glossary.md). A future `team` type (O12) is one more entry here. */
export const PROPERTY_TYPES = defineRegistry([
  definePropertyType({ key: 'text', description: 'Free text.', options: NONE, requires: NONE }),
  definePropertyType({
    key: 'localized_text',
    description: 'Text stored as a LocalizedString (one string per language).',
    options: NONE,
    requires: NONE,
  }),
  definePropertyType({
    key: 'number',
    description: 'A decimal number.',
    options: ['min', 'max'],
    requires: NONE,
  }),
  definePropertyType({
    key: 'integer',
    description: 'A whole number.',
    options: ['min', 'max'],
    requires: NONE,
  }),
  definePropertyType({ key: 'boolean', description: 'true or false.', options: NONE, requires: NONE }),
  definePropertyType({ key: 'date', description: 'A calendar date.', options: NONE, requires: NONE }),
  definePropertyType({ key: 'datetime', description: 'A point in time.', options: NONE, requires: NONE }),
  definePropertyType({
    key: 'time',
    description: 'A wall-clock time of day (HH:MM), no date and no zone.',
    options: NONE,
    requires: NONE,
  }),
  definePropertyType({
    key: 'select',
    description: 'One of a fixed set of options.',
    options: ['options', 'option_hints'],
    requires: ['options'],
  }),
  definePropertyType({
    key: 'multiselect',
    description: 'Several of a fixed set of options.',
    options: ['options', 'option_hints'],
    requires: ['options'],
  }),
  definePropertyType({
    key: 'geometry',
    description: 'A GeoJSON geometry (Z allowed).',
    options: ['geometry_type'],
    requires: NONE,
  }),
  definePropertyType({
    key: 'participant',
    description: 'A participant of the project (cardinality many: a list of participant ids).',
    options: ['select', 'cardinality'],
    requires: NONE,
  }),
  definePropertyType({
    key: 'role',
    description:
      'A role of the project (v3 selector source "Rollen"; cardinality many: a list of role keys).',
    options: ['select', 'cardinality'],
    requires: NONE,
  }),
  definePropertyType({
    key: 'reference',
    description: 'A reference to a feature of another type (cardinality many: a list of feature ids).',
    options: ['to', 'cardinality', 'display_property'],
    requires: ['to'],
  }),
  definePropertyType({
    key: 'file',
    description: 'A list of content-addressed blobs (FileRef[]), at most max_files (default 10).',
    options: ['accept', 'max_files'],
    requires: NONE,
  }),
] as const);
export type PropertyTypeKey = KeyOf<typeof PROPERTY_TYPES>;

/**
 * The property types whose value the device text index can hold: a string or a number. A
 * `tools.search.sources` entry must name a property of one of these (compile checks it).
 * `localized_text` is absent: its value is an object, which the index does not tokenize.
 */
export const SEARCHABLE_PROPERTY_TYPES = defineRegistry([
  { key: 'text', description: 'Free text.' },
  { key: 'select', description: 'The key of the chosen option.' },
  { key: 'number', description: 'A decimal number, matched as its text.' },
  { key: 'integer', description: 'A whole number, matched as its text.' },
] as const satisfies readonly { key: PropertyTypeKey; description: string }[]);

/** The default `max_files` of a `file` property (as v3). */
export const DEFAULT_MAX_FILES = 10;

/** Why a `file` value is refused (the check behind the form issue `type`). */
export const FILE_FAULTS = defineRegistry([
  { key: 'malformed_file', description: 'The value is not a list of { sha256, name, mime } entries.' },
  { key: 'too_many_files', description: 'The list holds more entries than max_files.' },
  { key: 'file_not_accepted', description: 'An entry matches none of the accept patterns.' },
] as const);
export type FileFault = KeyOf<typeof FILE_FAULTS>;
