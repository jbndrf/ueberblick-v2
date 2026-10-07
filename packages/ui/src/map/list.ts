import type { Bbox } from '@ueberblick/core/geo';
import type { Json } from '@ueberblick/core/model';
import { NAME_SORT, type MapFeature } from './contract';

// one collator: the same order as `localeCompare(b, undefined, { numeric: true })`, without building it per comparison (60k rows, R14)
const collator = new Intl.Collator(undefined, { numeric: true });

function compareValues(a: Json | undefined, b: Json | undefined): number {
  const missingA = a === undefined || a === null;
  const missingB = b === undefined || b === null;
  if (missingA || missingB) return Number(missingA) - Number(missingB); // missing values last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** Sorts by property keys as a view does: a leading "-" sorts descending. Returns a new array. */
export function sortFeatures<T extends Pick<MapFeature, 'id' | 'properties'> & { readonly name?: string }>(
  features: readonly T[],
  sort: readonly string[],
): T[] {
  const keys = sort.map((s) => (s.startsWith('-') ? { key: s.slice(1), dir: -1 } : { key: s, dir: 1 }));
  return [...features].sort((x, y) => {
    for (const { key, dir } of keys) {
      const av = key === NAME_SORT ? x.name : x.properties[key];
      const bv = key === NAME_SORT ? y.name : y.properties[key];
      const missing = av === undefined || av === null || bv === undefined || bv === null;
      // Missing values stay last in both directions.
      const c = compareValues(av, bv) * (missing ? 1 : dir);
      if (c !== 0) return c;
    }
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

/** The features whose anchor lies in the map extent: what the list shows next to the map. */
export function inExtent(features: readonly MapFeature[], extent: Bbox): MapFeature[] {
  const [w, s, e, n] = extent;
  return features.filter((f) => {
    const [lng, lat] = f.anchor;
    return lng >= w && lng <= e && lat >= s && lat <= n;
  });
}
