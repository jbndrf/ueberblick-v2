// How Daten is laid out (WP-659; v3 `getDataTabs` / `getVisibleDataTabs` / `getFieldsForFormRenderer`, state.svelte.ts
// 459-540, 585-690). Pure: the sub-tabs are the distinct `display.tab` names of the type's properties, the default tab
// ("Daten") first, the others by `tab_order` then name. A tab with no value left after hiding is dropped (v3 "hide
// tab + collapse rows"). Roles were applied before (`permissions.see` cut the rows), conditions arrive as a set.
import { DEFAULT_TAB, layoutTabs } from '@ueberblick/core';
import type { FeatureType, Key } from '@ueberblick/core/model';
import type { PropertyDisplayColumn, PropertyHistoryHint } from '@ueberblick/core/registry';
import type { FeatureSheetModel, PropertyRow } from '@ueberblick/ui';

/** The default tab has no name: the view labels it "Daten" (v3 `DEFAULT_DATA_TAB = ''`). */
export { DEFAULT_TAB };

/** One property in a line; `left` and `right` are half-width cells (v3 `getColumnClass`). */
export interface DataCell {
  readonly row: PropertyRow;
  readonly column: PropertyDisplayColumn;
}

export interface DataTabView {
  /** `DEFAULT_TAB` or the admin's tab name in the reader's language. */
  readonly name: string;
  readonly rows: readonly PropertyRow[];
  /** The rows grouped into lines as v3 `groupFieldsByLayout`: cells with the same `display.row` share a line. */
  readonly lines: readonly (readonly DataCell[])[];
}

export interface DataLayout {
  readonly tabs: readonly DataTabView[];
  /** The history wording per property; absent means "changes". */
  readonly hints: Readonly<Record<Key, PropertyHistoryHint>>;
}

/** The sheet model plus the Daten layout, which only the device side can build (the type's display settings and conditions). */
export type DataSheetModel = FeatureSheetModel & { readonly layout: DataLayout };

export interface LayoutInput {
  readonly type: FeatureType;
  /** The rows the sheet model built: already cut to what the role may read, in type order. */
  readonly rows: readonly PropertyRow[];
  /** Properties whose `display.condition` is false for this feature. Absent: none. */
  readonly conditionFalse?: ReadonlySet<Key>;
  readonly locale: string;
}

export function buildDataLayout(input: LayoutInput): DataLayout {
  const { type, rows, locale } = input;
  const hints: Record<Key, PropertyHistoryHint> = {};
  const shown: { value: PropertyRow; display: FeatureType['properties'][string]['display'] }[] = [];
  for (const row of rows) {
    const display = type.properties[row.key]?.display;
    if (display?.history !== undefined) hints[row.key] = display.history;
    if (input.conditionFalse?.has(row.key) === true) continue;
    shown.push({ value: row, display });
  }
  // the ordering is core's (shared with the builder's Felder hub); a tab with no value in it is not offered (v3)
  const ordered = layoutTabs(shown, { locale })
    .filter((tab) => tab.cells.some((c) => !c.value.empty))
    .map((tab) => ({
      name: tab.name,
      rows: tab.cells.map((c) => c.value),
      lines: tab.lines.map((line) => line.map((c): DataCell => ({ row: c.value, column: c.column }))),
    }));
  return { tabs: ordered, hints };
}

// `COLUMN_CLASS` (v3 `getColumnClass`) is the form's too: one table, `@ueberblick/ui` (R1).

/** A tab with no layout: one full-width cell per line, in the given order. */
export const plainLines = (rows: readonly PropertyRow[]): DataTabView['lines'] =>
  rows.map((row) => [{ row, column: 'full' as const }]);
