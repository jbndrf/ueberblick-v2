// The one name of a feature for people (WP-593, R1): the list row, the feature sheet header and relation links call it.
// A type declares no "name property" (R4), so the name is the first required text the feature has, in declaration order (B-014); a
// feature with none is named by its type and a short id. Pure; reads one row, never folds.
import type { Json } from '../model';
import type { FeatureType, Property } from '../schema';
import { localize } from './resolve';

/** What the name needs of a feature: a store row, a folded feature or a list row all fit. */
export interface NameSource {
  readonly id: string;
  readonly properties: { readonly [key: string]: Json };
}

/** The last four characters of an id, with `#`: enough to tell two unnamed features of one type apart. */
export const shortId = (id: string): string => `#${id.slice(-4)}`;

function textOf(value: Json | undefined, locales: readonly string[]): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const text: unknown = localize(value as { readonly [lang: string]: string }, locales);
    return typeof text === 'string' ? text.trim() : ''; // a stored map may hold anything
  }
  return '';
}

/**
 * The display name of `feature` for the language preference `locales`; the id when its type is not declared.
 * `via` is the reference property the name is shown for: its `display_property` ("Anzeigefeld", A-048) names the
 * property of the target type to show, when that has a value; otherwise the name is B-014's. One function decides (R1).
 */
export function displayName(
  type: FeatureType | undefined,
  feature: NameSource,
  locales: readonly string[],
  via?: Pick<Property, 'display_property'>,
): string {
  if (type === undefined) return feature.id;
  if (via?.display_property !== undefined) {
    const chosen = textOf(feature.properties[via.display_property], locales);
    if (chosen !== '') return chosen;
  }
  for (const [key, property] of Object.entries(type.properties)) {
    if (property.required !== true) continue; // an optional text is a finding or a note, not a name (B-014)
    if (property.type !== 'text' && property.type !== 'localized_text') continue;
    const text = textOf(feature.properties[key], locales);
    if (text !== '') return text;
  }
  const label = localize(type.label, locales);
  return label === '' ? feature.id : `${label} ${shortId(feature.id)}`;
}
