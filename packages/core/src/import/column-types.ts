/**
 * The types a column of an imported file can take (the review table of the GeoJSON wizard, v3 `SELECTABLE_TYPES`,
 * `geojson-import-dialog.svelte:24-31`). Each names the property type it becomes (R6: one registry, no inline union).
 * A free `select` is not offered: a value that is not an option key needs a value mapping, which the import has not.
 */
import { defineRegistry, type KeyOf } from '../registry/define';

export const IMPORT_COLUMN_TYPES = defineRegistry([
  { key: 'text', property: 'text', description: 'Short text.' },
  { key: 'long_text', property: 'text', description: 'Long text: a text input drawn as a textarea.' },
  { key: 'number', property: 'number', description: 'A decimal number.' },
  { key: 'integer', property: 'integer', description: 'A whole number.' },
  { key: 'boolean', property: 'boolean', description: 'true or false.' },
  { key: 'date', property: 'date', description: 'A calendar date (YYYY-MM-DD).' },
  { key: 'datetime', property: 'datetime', description: 'A point in time (ISO 8601).' },
] as const);
export type ImportColumnType = KeyOf<typeof IMPORT_COLUMN_TYPES>;
