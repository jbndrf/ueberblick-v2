import { z } from '../zod';
import {
  PROPERTY_DISPLAY_COLUMNS,
  PROPERTY_HISTORY_HINTS,
  type PropertyDisplayColumn,
  type PropertyHistoryHint,
} from '../registry';
import { ExprSchema, LocalizedStringSchema } from './primitives';

const columnKeys = PROPERTY_DISPLAY_COLUMNS.keys as unknown as [
  PropertyDisplayColumn,
  ...PropertyDisplayColumn[],
];
const hintKeys = PROPERTY_HISTORY_HINTS.keys as unknown as [PropertyHistoryHint, ...PropertyHistoryHint[]];

/**
 * How the read view (Daten) shows one property (WP-659; v3 `display_config`). Tabs are emergent: the distinct `tab`
 * names across a type's properties are its Daten sub-tabs. Who may see the value stays with `permissions.see`.
 */
export const PropertyDisplaySchema = z
  .strictObject({
    tab: LocalizedStringSchema.optional().describe(
      'The Daten sub-tab the property sits on. Absent: the default tab ("Daten").',
    ),
    tab_order: z
      .number()
      .optional()
      .describe(
        'Where the sub-tab sorts: the smallest value among its properties counts. Default 0; the default tab is first.',
      ),
    row: z
      .number()
      .optional()
      .describe(
        'The row inside the sub-tab, ascending (v3 row index). Properties with the same row share a line; ones without a row follow in type order, one per line.',
      ),
    column: z
      .enum(columnKeys)
      .optional()
      .describe(
        'full (default), left or right: two half-width cells of one row sit side by side, also on a phone. Within a row left comes before right before full.',
      ),
    hidden: z.boolean().optional().describe('Never shown in Daten (the value still exists and can be used).'),
    condition: ExprSchema.optional().describe(
      'A rule-language condition over `self` and `actor`: the property shows in Daten only while it is true.',
    ),
    history: z
      .enum(hintKeys)
      .optional()
      .describe(
        'How the history count reads: measurements ("n Messungen") or changes ("n Änderungen", default).',
      ),
  })
  .describe('How Daten shows this property: sub-tab, row, column, hidden, condition, history wording.');
export type PropertyDisplay = z.infer<typeof PropertyDisplaySchema>;
