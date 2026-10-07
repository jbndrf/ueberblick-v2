/**
 * Zuletzt: the newest Objekte on this device, as v3's `RecentSheet` showed the newest 50 cases. Only the newest page is
 * selected, never a sort of everything (bounded insertion, O(N log 50)); it runs once per opening of the sheet, one user
 * action (R14). A row has a name even with no geometry, and says so, because this list is how an Objekt without a
 * position is reached (R4).
 *
 * "By activity" is the order the fold last changed the feature in (`updatedSeq`, newest first). A row carries the
 * type's look (the map's icon or colour), and, once the rows' runs are loaded from the device (`withActivity`, only
 * the rows shown, WP-685), the newest entry's line, the time and the stage, as v3's row did.
 */
import type { Geo, Position } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { classifyingProperty, type ResolvedMarker } from '@ueberblick/core/marker';
import { isServed } from '@ueberblick/core/registry';
import type { ActivityView } from '@ueberblick/ui';
import { resolveLabel } from '@ueberblick/ui';
import { latestActivity } from '../../feature/activity/label';
import type { Locale } from '../../messages';
import { lookOf } from '../filter/filter-model';

export const RECENT_LIMIT = 50;

export interface RecentRow {
  readonly id: FeatureId;
  readonly type: Key;
  /** The Objektart's label (v3 showed the workflow name). */
  readonly typeLabel: string;
  /** The Objekt's display name. */
  readonly label: string;
  readonly hasLocation: boolean;
  /** The icon or colour dot of the type, as the map draws it (WP-674). */
  readonly look: ResolvedMarker;
  /** The newest entry of the Aktivität timeline ("3 Felder aktualisiert"); absent until loaded or when there is none. */
  readonly activity?: string;
  /** The last change, for the relative time (the feature sheet header's). */
  readonly updatedAt?: Instant;
  /** The current stage's label. */
  readonly stage?: string;
}

export interface RecentDeps {
  readonly facts: Pick<Facts, 'ofType'>;
  readonly config: Pick<CompiledConfig, 'file' | 'foldTypes'>;
  readonly labelOf: (state: FeatureState) => string;
  readonly locale: string;
  /** What the filter lets through (the map's and the Liste's predicate, R1): hidden features are not listed (WP-808). */
  readonly visible?: (id: FeatureId) => boolean;
}

/** Keeps the `limit` states with the highest `updatedSeq`, newest first. */
export function newest(states: Iterable<FeatureState>, limit: number): FeatureState[] {
  const top: FeatureState[] = [];
  for (const s of states) {
    if (!isServed(s.lifecycle)) continue;
    if (top.length === limit && s.updatedSeq <= (top[limit - 1] as FeatureState).updatedSeq) continue;
    let i = top.length;
    while (i > 0 && (top[i - 1] as FeatureState).updatedSeq < s.updatedSeq) i--;
    top.splice(i, 0, s);
    if (top.length > limit) top.pop();
  }
  return top;
}

export function recentFeatures(deps: RecentDeps, limit: number = RECENT_LIMIT): readonly RecentRow[] {
  const { facts, config, labelOf, locale, visible } = deps;
  const types = Object.keys(config.file.types ?? {}) as Key[];
  const candidates = function* (): Generator<FeatureState> {
    for (const t of types)
      for (const s of facts.ofType(t)) if (visible === undefined || visible(s.id)) yield s;
  };
  return newest(candidates(), limit).map((s) => {
    const geometryKey = config.foldTypes.get(s.type)?.primaryGeometry;
    const geometry = geometryKey === undefined ? undefined : s.properties[geometryKey];
    const type = config.file.types?.[s.type];
    const classify = type === undefined ? undefined : classifyingProperty(type);
    const value = classify === undefined ? undefined : s.properties[classify];
    return {
      id: s.id,
      look: lookOf(type ?? {}, typeof value === 'string' ? value : undefined),
      ...(s.changedAt === undefined ? {} : { updatedAt: s.changedAt }),
      type: s.type,
      typeLabel: resolveLabel(config.file.types?.[s.type]?.label, locale, s.type),
      label: labelOf(s),
      hasLocation: geometry !== undefined && geometry !== null,
    };
  });
}

/**
 * The rows with the newest entry and stage of their timeline. `activityOf` is the device's Aktivität view of a feature
 * (undefined when it is not warm); `updatedAt` is the sheet header's time. Only the rows shown are read (O(rows), R14).
 */
export function withActivity(
  rows: readonly RecentRow[],
  read: {
    activityOf: (id: FeatureId) => ActivityView | undefined;
    updatedAt: (id: FeatureId) => Instant | undefined;
  },
  locale: Locale,
): readonly RecentRow[] {
  return rows.map((row) => {
    const view = read.activityOf(row.id);
    const latest = view === undefined ? {} : latestActivity(view, locale);
    const updatedAt = read.updatedAt(row.id) ?? row.updatedAt;
    return {
      ...row,
      ...(latest.text === undefined ? {} : { activity: latest.text }),
      ...(latest.stage === undefined ? {} : { stage: latest.stage }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    };
  });
}

/** The point a row flies to: the fold's point on the surface of the primary geometry; none for an Objekt without geometry. */
export function anchorOfFeature(
  deps: { config: Pick<CompiledConfig, 'foldTypes'>; geo: Geo },
  state: FeatureState | undefined,
): Position | undefined {
  if (state === undefined) return undefined;
  const key = deps.config.foldTypes.get(state.type)?.primaryGeometry;
  const g = key === undefined ? undefined : state.properties[key];
  if (g === undefined || g === null || typeof g !== 'object' || Array.isArray(g)) return undefined;
  return deps.geo.derive(g as never).pointOnSurface.coordinates;
}
