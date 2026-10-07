import type { Json } from '../model';
import { PREF_FONT_SIZES, PREF_THEMES } from '../registry/prefs';

/** Longest serialized value of one key, in characters. */
export const PREF_MAX_VALUE_CHARS = 16 * 1024;
/** Most keys one record may hold. */
export const PREF_MAX_ENTRIES = 500;
/** Most saved filters one person may keep. */
export const PREF_MAX_SAVED_FILTERS = 100;

const SEGMENT = /^[a-z][a-z0-9_]{0,63}$/;
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** A client time. Fixed width, so comparing two of them as strings compares the instants. */
export const PREF_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A saved filter: a name and one rule-language filter per Objektart (the filter format of `core/filters`, WP-640). */
export interface SavedFilter {
  readonly id: string;
  readonly name: string;
  readonly filters: Readonly<Record<string, string>>;
}

export function isJson(v: unknown, depth = 0): v is Json {
  if (depth > 16) return false;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  if (typeof v === 'object') return Object.values(v as object).every((x) => isJson(x, depth + 1));
  return false;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isId = (v: unknown): boolean => typeof v === 'string' && v.length >= 1 && v.length <= 64;

const isSavedFilter = (v: unknown): boolean => {
  if (!isObject(v) || Object.keys(v).sort().join() !== 'filters,id,name') return false;
  const { id, name, filters } = v;
  return (
    isId(id) &&
    typeof name === 'string' &&
    name.length >= 1 &&
    name.length <= 200 &&
    isObject(filters) &&
    Object.entries(filters).every(([k, f]) => k.length <= 64 && typeof f === 'string' && f.length <= 4000)
  );
};

/**
 * What the person switched off in the Einfach tab (`filters.hidden`): whole Objektarten and single stage values per
 * Objektart. Absent means the person never switched anything, so the project's start filter applies (A-040).
 */
export interface HiddenFilter {
  readonly types: readonly string[];
  readonly values: Readonly<Record<string, readonly string[]>>;
}

const isKeyList = (v: unknown, max: number): boolean =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((x) => typeof x === 'string' && x.length >= 1 && x.length <= 200);

const isHiddenFilter = (v: unknown): boolean =>
  isObject(v) &&
  Object.keys(v).sort().join() === 'types,values' &&
  isKeyList(v['types'], 500) &&
  isObject(v['values']) &&
  Object.entries(v['values']).every(([k, list]) => k.length <= 64 && isKeyList(list, 500));

/** The map layers a person has on: one base (or none) and any number of overlays, by layer key (WP-621). */
export interface MapLayerChoice {
  readonly base: string | null;
  readonly overlays: readonly string[];
}

const isMapLayerChoice = (v: unknown): boolean =>
  isObject(v) &&
  Object.keys(v).sort().join() === 'base,overlays' &&
  (v['base'] === null || isId(v['base'])) &&
  Array.isArray(v['overlays']) &&
  v['overlays'].length <= 100 &&
  v['overlays'].every(isId);

type ValueCheck = (v: unknown) => boolean;

/** The check of a key path's value, or undefined when the path is not a preference key (unknown keys are refused). */
function checkOfPath(path: string): ValueCheck | undefined {
  const parts = path.split('.');
  if (!parts.every((p) => SEGMENT.test(p))) return undefined;
  const [section, name] = parts;
  if (section === 'tools' && parts.length === 2) return (v) => typeof v === 'boolean';
  if (section === 'tool_prefs' && parts.length === 3) return (v) => isJson(v);
  if (path === 'filters.saved')
    return (v) => Array.isArray(v) && v.length <= PREF_MAX_SAVED_FILTERS && v.every(isSavedFilter);
  if (path === 'filters.hidden') return isHiddenFilter;
  if (path === 'filters.active') return (v) => v === null || isId(v);
  if (section === 'ui' && parts.length === 2) {
    if (name === 'theme') return (v) => typeof v === 'string' && PREF_THEMES.has(v);
    if (name === 'font_size') return (v) => typeof v === 'string' && PREF_FONT_SIZES.has(v);
    if (name === 'locale') return (v) => typeof v === 'string' && LOCALE.test(v);
    if (name === 'map_layers') return isMapLayerChoice;
    // The selected tab of a sheet (v3 remembered it): a short key, e.g. `simple` or `views`.
    // Offline-Bilder (v3 `fullLocalCopy`, WP-667): keep photo thumbnails on the device; follows the person.
    if (name === 'offline_images') return (v) => typeof v === 'boolean';
    if (name === 'filter_tab') return (v) => typeof v === 'string' && SEGMENT.test(v);
  }
  return undefined;
}

/** Whether `path` is a preference key at all. */
export const isPrefPath = (path: string): boolean => checkOfPath(path) !== undefined;

export type PrefValidation = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Whether `value` is a legal value for `path`: the path must be known, the type right, the size within the cap. */
export function validatePrefValue(path: string, value: unknown): PrefValidation {
  const check = checkOfPath(path);
  if (check === undefined) return { ok: false, message: `Unknown preference key "${path}".` };
  if (!check(value)) return { ok: false, message: `Wrong value for "${path}".` };
  if (JSON.stringify(value).length > PREF_MAX_VALUE_CHARS)
    return { ok: false, message: `The value of "${path}" is too large.` };
  return { ok: true };
}
