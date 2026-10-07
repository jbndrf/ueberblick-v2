import type { FeatureId, Json } from '@ueberblick/core/model';
import type { ListColumn } from '@ueberblick/ui';

export interface GroupRow {
  readonly id: FeatureId;
  readonly name: string;
  readonly properties: { readonly [key: string]: Json };
}

export interface RowGroup<R extends GroupRow> {
  readonly type: string;
  readonly label: string;
  readonly columns: readonly ListColumn[];
  readonly rows: readonly R[];
}

const text = (v: Json | undefined): string => (v === undefined || v === null ? '' : String(v));

/**
 * The Liste's tables: one per Objektart (v3 groups its cluster detail by type, `ClusterDetailModule.svelte:52-60`), each
 * with that type's own columns, so a Gebäude never sits under the Veranstaltung headers. A column whose value is the
 * display name in every row is dropped: the first column already shows it. O(rows x columns).
 */
export function groupRows<R extends GroupRow>(
  rows: readonly R[],
  typeOf: (id: FeatureId) => string | undefined,
  labelOf: (type: string) => string,
  columnsOf: (type: string) => readonly ListColumn[],
): RowGroup<R>[] {
  const byType = new Map<string, R[]>();
  for (const r of rows) {
    const t = typeOf(r.id);
    if (t === undefined) continue;
    const list = byType.get(t);
    if (list === undefined) byType.set(t, [r]);
    else list.push(r);
  }
  return [...byType.entries()]
    .map(([type, members]) => ({
      type,
      label: labelOf(type),
      rows: members,
      columns: columnsOf(type).filter((c) => !members.every((m) => text(m.properties[c.key]) === m.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
