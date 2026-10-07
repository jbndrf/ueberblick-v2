// What the search tool asks and shows. Pure: the index lives in the device store (`searchText`), the tool
// only reads through two ports, so a later API (H4) can reuse `searchFeatures` unchanged. It builds no index (R14).
import type { Geo, Geometry, Position } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, JsonValue, Key } from '@ueberblick/core/model';
import { GEO_GEOMETRY_TYPES } from '@ueberblick/core/registry';
import { ToolHostError, type PanelToolContext, type ToolTextSource } from '@ueberblick/ui/tool-api';
import { isServed } from '@ueberblick/core/registry';

export type SearchPorts = Pick<PanelToolContext, 'searchText' | 'feature'>;

export interface SearchResult {
  readonly id: FeatureId;
  readonly type: Key;
  /** The value of the first configured source property of this type that holds text, else the id. */
  readonly label: string;
}

const bad = (): never => {
  throw new ToolHostError('invalid_option', 'search', 'Invalid search option "sources"');
};

/** `tools.search.sources`: a list of `type.property` entries (docs/05). No settings means no sources. */
export function readSearchSources(raw: Readonly<Record<string, JsonValue>>): readonly ToolTextSource[] {
  const list = raw.sources;
  if (list === undefined) return [];
  if (!Array.isArray(list)) return bad();
  return list.map((entry) => {
    const parts = typeof entry === 'string' ? entry.split('.') : [];
    const [type, property] = parts;
    if (parts.length !== 2 || !type || !property) return bad();
    return { type: type as Key, property };
  });
}

function labelOf(state: FeatureState, sources: readonly ToolTextSource[]): string {
  for (const s of sources) {
    if (s.type !== state.type) continue;
    const v = state.properties[s.property];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  return state.id;
}

/** Results for one query: an index lookup, then one read per result (at most `limit`). */
export function searchFeatures(
  ports: SearchPorts,
  sources: readonly ToolTextSource[],
  query: string,
  limit: number,
): readonly SearchResult[] {
  if (sources.length === 0 || query.trim() === '') return [];
  const results: SearchResult[] = [];
  for (const id of ports.searchText(sources, query, limit)) {
    const state = ports.feature(id);
    if (!state || !isServed(state.lifecycle)) continue;
    results.push({ id, type: state.type, label: labelOf(state, sources) });
  }
  return results;
}

const isGeometry = (v: unknown): v is Geometry =>
  typeof v === 'object' &&
  v !== null &&
  'type' in v &&
  typeof v.type === 'string' &&
  GEO_GEOMETRY_TYPES.has(v.type) &&
  ('coordinates' in v || 'geometries' in v);

/**
 * Where the map centres for a feature: core.geo's point on the surface of its declared primary geometry
 * (`FoldType.primaryGeometry`, B-009), given as `property`. No primary geometry, no value or a malformed one
 * means no centre; there is no fallback to another geometry property. Z is dropped.
 */
export function centreOf(geo: Geo, state: FeatureState, property: Key | undefined): Position | undefined {
  if (property === undefined) return undefined;
  const v = state.properties[property];
  if (!isGeometry(v)) return undefined;
  try {
    const [lon, lat] = geo.derive(v).pointOnSurface.coordinates;
    return lon === undefined || lat === undefined ? undefined : [lon, lat];
  } catch {
    return undefined;
  }
}
