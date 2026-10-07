// The field history behind the count in Daten (v3 CmmnFieldChrome: the toggle shows when a property has more than one
// value). Pure; groups the sheet model's history rows by property (they arrive newest first, capped per property).
import type { HistoryRow } from '@ueberblick/ui';

/** v3 `showHistoryToggle`: a value that never changed has no history worth a dialog. */
export const HISTORY_MIN = 2;

export function historyByProperty(rows: readonly HistoryRow[]): ReadonlyMap<string, readonly HistoryRow[]> {
  const out = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const list = out.get(row.property);
    if (list === undefined) out.set(row.property, [row]);
    else list.push(row);
  }
  return out;
}

export function historyTime(at: string, locale: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
