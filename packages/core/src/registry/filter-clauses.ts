import { defineRegistry, type KeyOf } from './define';
import type { PropertyTypeKey } from './property-types';

/**
 * The rows of the view builder (WP-665, v3 `FilterBuilder`): what one row of a saved view says. Every row is written
 * as rule-language source (`core/filters/clauses`), never as a second condition language (R5).
 */
export const FILTER_CLAUSE_KINDS = defineRegistry([
  { key: 'field', description: 'A condition on one property of one Objektart (v3 "Felder filtern").' },
  { key: 'stage', description: 'The stages one Objektart may be in (v3 "Stufe").' },
  { key: 'when', description: 'When the Objekt was created or last changed (v3 "Erstellt" / "Geändert").' },
  { key: 'created_by', description: 'Who created the Objekt (v3 "Erstellt von").' },
  {
    key: 'rule',
    description:
      'A term of a saved view the builder has no row for (written by hand or by an assistant). Kept as it is, shown read-only.',
  },
] as const);
export type FilterClauseKind = KeyOf<typeof FILTER_CLAUSE_KINDS>;

/** How a property is edited in the builder (the editors of the v3 property row). */
export const FILTER_EDITORS = defineRegistry([
  { key: 'text', description: 'Contains a fragment (v3 ClauseTextContains).' },
  {
    key: 'number',
    description: 'Between a minimum and a maximum, either may be open (v3 ClauseNumberRange).',
  },
  { key: 'date', description: 'Between two days, either may be open (v3 ClauseDateRange).' },
  { key: 'choice', description: 'Is any of several options (v3 ClauseOptionMultiSelect).' },
  { key: 'boolean', description: 'Is yes or is no (WP-809).' },
  { key: 'time', description: 'Between two times of day, either may be open (WP-809).' },
  { key: 'participant', description: 'Is the signed-in person, "ich" (v3 operator "is me", WP-809).' },
  { key: 'presence', description: 'Has no value or has a value (v3 "is empty" / "is not empty", WP-809).' },
] as const);
export type FilterEditor = KeyOf<typeof FILTER_EDITORS>;

/** The editor of each property type that has one; the others are not offered (v3 offered none for them either). */
export const FILTER_EDITOR_BY_TYPE: Readonly<Partial<Record<PropertyTypeKey, FilterEditor>>> = {
  text: 'text',
  number: 'number',
  integer: 'number',
  date: 'date',
  datetime: 'date',
  select: 'choice',
  multiselect: 'choice',
  boolean: 'boolean',
  time: 'time',
  participant: 'participant',
  reference: 'presence',
  localized_text: 'presence',
};

/** The states of a presence row: no value, or any value (`== null`, `!= null`). */
export const FILTER_PRESENCE_STATES = defineRegistry([
  { key: 'empty', description: 'Has no value (v3 "ist leer").' },
  { key: 'filled', description: 'Has a value (v3 "ist nicht leer").' },
] as const);
export type FilterPresence = KeyOf<typeof FILTER_PRESENCE_STATES>;

/** The two moments of a "when" row and the system field each reads (`SYSTEM_FIELDS`, WP-306). */
export const FILTER_WHEN_FIELDS = defineRegistry([
  { key: 'created', description: 'When the Objekt was created ("Erstellt"): `$created_at`.' },
  { key: 'changed', description: 'When the Objekt last changed ("Geändert"): `$changed_at`.' },
] as const);
export type FilterWhenField = KeyOf<typeof FILTER_WHEN_FIELDS>;
export const FILTER_WHEN_SYSTEM: Readonly<Record<FilterWhenField, string>> = {
  created: '$created_at',
  changed: '$changed_at',
};

/** How a "when" row compares (v3 DateClause: older than, newer than, between). */
export const FILTER_WHEN_MODES = defineRegistry([
  { key: 'older', description: 'More than N days ago (v3 "Älter als (Tage)").' },
  { key: 'newer', description: 'At most N days ago (v3 "Neuer als (Tage)").' },
  { key: 'between', description: 'Between two days, either may be open (v3 "Zwischen").' },
] as const);
export type FilterWhenMode = KeyOf<typeof FILTER_WHEN_MODES>;

/** The system field of a created-by row (`SYSTEM_FIELDS`, WP-306). */
export const FILTER_CREATED_BY_SYSTEM = '$created_by';
