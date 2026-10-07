import { defineRegistry, type KeyOf } from './define';

/**
 * How the history count of a property reads in Daten (`display.history`, WP-659). v3 chose the wording by the field's
 * write mode ("{n} Messungen" for observations, "{n} Änderungen" for singletons); v4 has one write path, so the admin
 * says it on the property. The distinction matters to the participant: a reading is a new measurement, not a correction.
 */
export const PROPERTY_HISTORY_HINTS = defineRegistry([
  {
    key: 'changes',
    description: 'Each value replaced the last one: the count reads "{n} Änderungen". The default.',
  },
  {
    key: 'measurements',
    description: 'Each value is a new reading over time: the count reads "{n} Messungen".',
  },
] as const);
export type PropertyHistoryHint = KeyOf<typeof PROPERTY_HISTORY_HINTS>;

/**
 * Where a property sits in its row of Daten (`display.column`, WP-659; v3 `display_config.column`, `ColumnPosition`).
 * Two half-width cells (left and right) of the same `row` sit side by side, on a phone too; `full` is the whole width.
 */
export const PROPERTY_DISPLAY_COLUMNS = defineRegistry([
  { key: 'full', description: 'The whole width of the row. The default.' },
  { key: 'left', description: 'Half width, on the left of its row.' },
  { key: 'right', description: 'Half width, on the right of its row.' },
] as const);
export type PropertyDisplayColumn = KeyOf<typeof PROPERTY_DISPLAY_COLUMNS>;
