/**
 * What the cluster detail shows, computed from the features on the device (never fetched): v3's `buildClusterGroups`
 * (`+page.svelte:1808-1869`). One group per Objektart (v3: workflow), in it one row per value of the classifying
 * property that occurs (WP-674: `classify.property`, else the stage of the process; v3's two filter modes are one
 * select property in v4). A row's colour is the one the map draws that value in (`lookOf`); v3 drew grey rows in stage
 * mode because its colour lookup used another key than the one it stored, which is not ported. Rows and groups are
 * sorted by count, biggest first. The cost is the number of members of the tapped cluster (R14).
 */
import { localize } from '@ueberblick/ui';
import type { ClusterMember } from '@ueberblick/ui';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { classifyingProperty } from '@ueberblick/core';
import { lookOf } from '../sheets/filter/filter-model';

export interface ClusterRow {
  /** The value of the classifying property; the Objektart when it has none. */
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly count: number;
  /** Rounded percent of the group (v3). */
  readonly percentage: number;
  readonly ids: readonly FeatureId[];
}

export interface ClusterGroup {
  readonly type: Key;
  readonly label: string;
  readonly totalCount: number;
  readonly rows: readonly ClusterRow[];
}

export const rowIds = (row: ClusterRow | undefined): readonly FeatureId[] => row?.ids ?? [];

export function buildClusterGroups(
  config: CompiledConfig,
  locale: string,
  members: readonly ClusterMember[],
  feature: (id: FeatureId) => FeatureState | undefined,
): readonly ClusterGroup[] {
  const types = config.file.types ?? {};
  const byType = new Map<Key, Map<string, FeatureId[]>>();
  for (const { id } of members) {
    const state = feature(id);
    if (state === undefined) continue;
    const def = types[state.type];
    const property = def === undefined ? undefined : classifyingProperty(def);
    const value = property === undefined ? undefined : state.properties[property];
    const key = typeof value === 'string' ? value : state.type;
    const rows = byType.get(state.type) ?? new Map<string, FeatureId[]>();
    const ids = rows.get(key);
    if (ids === undefined) rows.set(key, [id]);
    else ids.push(id);
    byType.set(state.type, rows);
  }
  const groups: ClusterGroup[] = [];
  for (const [type, rows] of byType) {
    const def = types[type];
    const typeLabel = localize(def?.label ?? type, locale);
    const property = def === undefined ? undefined : classifyingProperty(def);
    const options = property === undefined ? undefined : def?.properties[property]?.options;
    const total = [...rows.values()].reduce((n, ids) => n + ids.length, 0);
    groups.push({
      type,
      label: typeLabel,
      totalCount: total,
      rows: [...rows.entries()]
        .map(([key, ids]) => ({
          key,
          label: key === type ? typeLabel : localize(options?.[key] ?? key, locale),
          color:
            def === undefined
              ? lookOf({}, undefined).color
              : lookOf(def, key === type ? undefined : key).color,
          count: ids.length,
          percentage: Math.round((ids.length / total) * 100),
          ids,
        }))
        .sort((a, b) => b.count - a.count),
    });
  }
  return groups.sort((a, b) => b.totalCount - a.totalCount);
}
