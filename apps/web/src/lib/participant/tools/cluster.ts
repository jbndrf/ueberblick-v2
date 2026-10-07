/**
 * The Cluster tool (v3 `tools.cluster`, the Cluster tab of Karteninhalt, "Gruppierung aufheben"): the person's switch and
 * cap, and what the map is told. Clustering itself stays on; the tool only un-clusters the features in view while there
 * are at most `cap` of them (the map's own cluster worker answers, `MapHandle.setUncluster`). The switch and the cap are
 * personal preferences (`tool_prefs.cluster.uncluster` and `.cap`, WP-612), so they follow the person and work offline.
 */
import type { Json, JsonValue } from '@ueberblick/core/model';
import type { UnclusterStats } from '@ueberblick/ui';
import type { MessageKey } from '../messages';
import type { ToolEntry } from './entries';

export const CLUSTER_TOOL = 'cluster';
/** v3's default (`FilterSheet.svelte:178`). */
export const DEFAULT_CAP = 500;

export interface ClusterPrefs {
  readonly uncluster: boolean;
  readonly cap: number;
}

/** What the person typed in the cap field: v3 takes `parseInt` and ignores anything that is not a positive number (`handleCapInput`). */
export function parseCap(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export function clusterPrefs(prefs: Readonly<Record<string, Json>> | undefined): ClusterPrefs {
  const cap = prefs?.['cap'];
  return {
    uncluster: prefs?.['uncluster'] === true,
    cap: typeof cap === 'number' && Number.isSafeInteger(cap) && cap > 0 ? cap : DEFAULT_CAP,
  };
}

/** The cap the map is told: only while the tool is on for the person and its switch is on; otherwise `null` (cluster as usual). */
export function unclusterCap(entries: readonly ToolEntry[], prefs: ClusterPrefs): number | null {
  const on = entries.some((e) => e.key === CLUSTER_TOOL && e.on);
  return on && prefs.uncluster ? prefs.cap : null;
}

export interface StatsMessage {
  readonly key: Extract<MessageKey, 'filter_cluster_showing' | 'filter_cluster_too_many'>;
  readonly count: number;
}

/** The stats line (v3 :674-681): nothing while there is nothing in view. */
export function statsMessage(stats: UnclusterStats | undefined): StatsMessage | undefined {
  if (stats === undefined || stats.inView <= 0) return undefined;
  return { key: stats.single ? 'filter_cluster_showing' : 'filter_cluster_too_many', count: stats.inView };
}

/** The slice of `ToolPerson` the writes need. */
export interface PreferenceWriter {
  setPreference(tool: string, name: string, value: JsonValue): void;
}
export const writeUncluster = (person: PreferenceWriter, on: boolean): void =>
  person.setPreference(CLUSTER_TOOL, 'uncluster', on);
export const writeCap = (person: PreferenceWriter, cap: number): void =>
  person.setPreference(CLUSTER_TOOL, 'cap', cap);
