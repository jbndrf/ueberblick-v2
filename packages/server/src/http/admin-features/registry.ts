import { defineRegistry, SYSTEM_FIELD_SIGIL, type KeyOf } from '@ueberblick/core';

/** Sort directions of the admin feature list (`dir=`). */
export const SORT_DIRECTIONS = defineRegistry([
  { key: 'asc', description: 'Smallest first; rows without a value come first.' },
  { key: 'desc', description: 'Largest first; rows without a value come last.' },
] as const);
export type SortDirection = KeyOf<typeof SORT_DIRECTIONS>;

/**
 * The system columns of the list are core's `SYSTEM_FIELDS` under their sigil key (`$lifecycle`, `$created_by`,
 * `$created_at`, `$changed_at`) plus the feature id (`$id`). The same key names the column in `sort=`, `filter.`,
 * `column=`, the cursor and a row. A property key cannot start with `$` (`KeySchema`), so the two never meet.
 */
export const ID_COLUMN = `${SYSTEM_FIELD_SIGIL}id`;
/** The row key of the Objekt's `updated_seq` (not a column: it is neither sorted nor filtered). */
export const SEQ_COLUMN = `${SYSTEM_FIELD_SIGIL}seq`;

/** How a column's value is read, filtered and sorted. */
export const COLUMN_KINDS = defineRegistry([
  {
    key: 'text',
    description:
      'A string: sorted case-insensitively (COLLATE NOCASE), except ids and timestamps (binary); filter values are strings.',
  },
  { key: 'number', description: 'A number: filter values are parsed as numbers.' },
  { key: 'boolean', description: 'true or false, stored as 1 or 0; filter values are true or false.' },
  {
    key: 'array',
    description: 'A list of values (multiselect): filtered and counted per entry; not sortable.',
  },
  { key: 'opaque', description: 'An object or file list: neither sortable nor filterable.' },
] as const);
export type ColumnKind = KeyOf<typeof COLUMN_KINDS>;

/** Property type to column kind; a type missing here (geometry) is not a column. */
export const COLUMN_KIND_OF_TYPE: Readonly<Record<string, ColumnKind>> = {
  text: 'text',
  select: 'text',
  date: 'text',
  datetime: 'text',
  time: 'text',
  participant: 'text',
  reference: 'text',
  role: 'text',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  multiselect: 'array',
  localized_text: 'opaque',
  file: 'opaque',
};

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
/** Values one distinct query returns. */
export const DISTINCT_CAP = 500;
/** The filter value that means "no value" (BaseTable's `EMPTY_FILTER_KEY`). */
export const EMPTY_VALUE = '__empty__';

/** What a run in a feature's history came to (`runs.outcome` accepted / rejected, as the Aktivität timeline says it). */
export const HISTORY_OUTCOMES = defineRegistry([
  { key: 'accepted', description: 'The run was planned and its observations were appended.' },
  { key: 'refused', description: 'The run was refused; it has no observations, only its refusal.' },
] as const);
export type HistoryOutcome = KeyOf<typeof HISTORY_OUTCOMES>;

/** Runs one history page returns at most. */
export const HISTORY_LIMIT = 50;
