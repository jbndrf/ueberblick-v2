// The Daten layout of one Objektart (WP-659; v3 `getDataTabs`, `groupFieldsByLayout`): the one ordering that the reader's
// Daten view and the builder's Felder hub share (R1). Tabs are the distinct `display.tab` names, the default tab first,
// the others by `tab_order` (the smallest value among their properties) then name; inside a tab properties go by
// `display.row`, then left < right < full, then the type's order, and a property with a row shares its line with the
// others of the same row (one without a row is a line of its own). Pure: no I/O.
import { localize } from '../locale';
import type { PropertyDisplayColumn } from '../registry';
import type { PropertyDisplay } from '../schema/property-display';

/** The default tab has no name: the view labels it "Daten" (v3 `DEFAULT_DATA_TAB = ''`). */
export const DEFAULT_TAB = '';

export interface LayoutInput<T> {
  readonly value: T;
  readonly display: PropertyDisplay | undefined;
}

/** One property in a line; `left` and `right` are half-width cells. */
export interface LayoutCell<T> {
  readonly value: T;
  readonly column: PropertyDisplayColumn;
}

export interface LayoutTab<T> {
  /** `DEFAULT_TAB` or the admin's tab name in the reader's language. */
  readonly name: string;
  /** The cells in Daten order. */
  readonly cells: readonly LayoutCell<T>[];
  /** The cells grouped into lines. */
  readonly lines: readonly (readonly LayoutCell<T>[])[];
}

export interface LayoutOptions {
  readonly locale: string;
  /** Keep the default tab although nothing sits on it (the builder always shows it). */
  readonly keepDefaultTab?: boolean;
}

const COLUMN_ORDER: Record<PropertyDisplayColumn, number> = { left: 0, right: 1, full: 2 };

/** Orders `items` (in type order) into tabs of lines. Hidden properties (`display.hidden`) are left out. */
export function layoutTabs<T>(items: readonly LayoutInput<T>[], options: LayoutOptions): LayoutTab<T>[] {
  const { locale } = options;
  interface Placed {
    readonly cell: LayoutCell<T>;
    readonly order: number;
    readonly at: number;
  }
  const tabs = new Map<string, { order: number; items: Placed[] }>();
  if (options.keepDefaultTab === true) tabs.set(DEFAULT_TAB, { order: 0, items: [] });
  items.forEach(({ value, display }, at) => {
    if (display?.hidden === true) return;
    const name = display?.tab === undefined ? DEFAULT_TAB : localize(display.tab, [locale]);
    const tabOrder = display?.tab_order ?? 0;
    const tab = tabs.get(name) ?? { order: tabOrder, items: [] };
    tab.order = Math.min(tab.order, tabOrder);
    tab.items.push({
      cell: { value, column: display?.column ?? 'full' },
      order: display?.row ?? Number.POSITIVE_INFINITY,
      at,
    });
    tabs.set(name, tab);
  });
  const compare = new Intl.Collator(locale).compare;
  return [...tabs.entries()]
    .sort(([an, a], [bn, b]) => {
      if ((an === DEFAULT_TAB) !== (bn === DEFAULT_TAB)) return an === DEFAULT_TAB ? -1 : 1;
      return a.order - b.order || compare(an, bn);
    })
    .map(([name, tab]) => {
      // v3 (state.svelte.ts 686-692): by row, then left < right < full; unplaced ones follow in type order
      const sorted = [...tab.items].sort(
        (x, y) =>
          x.order - y.order || COLUMN_ORDER[x.cell.column] - COLUMN_ORDER[y.cell.column] || x.at - y.at,
      );
      const lines: LayoutCell<T>[][] = [];
      let last: number | undefined;
      for (const i of sorted) {
        const line = lines[lines.length - 1];
        // an unplaced property is a line of its own (v3 `fallbackRow`)
        if (line !== undefined && Number.isFinite(i.order) && i.order === last) line.push(i.cell);
        else lines.push([i.cell]);
        last = i.order;
      }
      return { name, cells: sorted.map((i) => i.cell), lines };
    });
}
