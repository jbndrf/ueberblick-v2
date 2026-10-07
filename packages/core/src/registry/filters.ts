import { defineRegistry, type KeyOf } from './define';
import type { PropertyTypeKey } from './property-types';

/**
 * What a filter builder may offer on a property (WP-640, `core/filters`). R6: the keys live here. Every operator
 * is a way to write a rule-language expression (docs/06), never a second condition language (R5). The set is v3's
 * (`view-builder/operators.ts`).
 */
export const FILTER_OPERATORS = defineRegistry([
  { key: 'eq', description: 'Is equal to a value (v3 "equals").' },
  {
    key: 'between',
    description: 'Lies between a lower and an upper bound; either may be open (v3 "between").',
  },
  { key: 'older_than_days', description: 'The date lies more than N days back (v3 "older than").' },
  { key: 'newer_than_days', description: 'The date lies at most N days back (v3 "newer than").' },
  {
    key: 'in',
    description: 'Is any of several values; for a multiselect, holds at least one (v3 "is any of").',
  },
  { key: 'not_in', description: 'Is none of several values (v3 "is none of").' },
  { key: 'contains', description: 'The text contains a fragment.' },
  { key: 'not_contains', description: 'The text does not contain a fragment.' },
  { key: 'is_empty', description: 'Has no value.' },
  { key: 'is_not_empty', description: 'Has a value.' },
  {
    key: 'is_me',
    description: 'Is the signed-in person ("ich"); only for participant properties (v3 "is me").',
  },
] as const);
export type FilterOperator = KeyOf<typeof FILTER_OPERATORS>;

const EMPTY: readonly FilterOperator[] = ['is_empty', 'is_not_empty'];
const WHEN: readonly FilterOperator[] = ['between', 'older_than_days', 'newer_than_days', ...EMPTY];
const CHOICE: readonly FilterOperator[] = ['in', 'not_in', ...EMPTY];
const TEXT: readonly FilterOperator[] = ['contains', 'not_contains', ...EMPTY];

/**
 * The operators per property type, as v3's `operators.ts` offered them per field type. Total over the property
 * types: a new type fails to compile until it says.
 */
export const FILTER_OPERATORS_BY_TYPE: Readonly<Record<PropertyTypeKey, readonly FilterOperator[]>> = {
  text: TEXT,
  localized_text: EMPTY,
  number: ['eq', 'between', ...EMPTY],
  integer: ['eq', 'between', ...EMPTY],
  boolean: ['eq', ...EMPTY],
  date: WHEN,
  datetime: WHEN,
  time: ['between', ...EMPTY],
  select: CHOICE,
  multiselect: CHOICE,
  geometry: EMPTY,
  participant: ['in', 'is_me', ...EMPTY],
  role: CHOICE,
  reference: EMPTY,
  file: EMPTY,
};
