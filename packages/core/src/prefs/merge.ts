import type { Instant, Json } from '../model';
import type { HiddenFilter, MapLayerChoice, SavedFilter } from './paths';

/** One write of one key, as a device sends it: `at` is the client time of the edit. */
export interface PrefEntry {
  readonly path: string;
  readonly value: Json;
  readonly at: Instant;
}

/** The record as stored: per key path the value and the time of the edit that set it. */
export type PrefStore = Readonly<Record<string, { readonly value: Json; readonly at: Instant }>>;

/** The record a participant reads (docs/04). Absent keys are absent (`tools`) or empty (`saved`, `active`). */
export interface Prefs {
  readonly tools: Readonly<Record<string, boolean>>;
  readonly tool_prefs: Readonly<Record<string, Readonly<Record<string, Json>>>>;
  readonly filters: {
    readonly saved: readonly SavedFilter[];
    readonly active: string | null;
    /** The person's Einfach switches; null while the person never switched anything. */
    readonly hidden: HiddenFilter | null;
  };
  readonly ui: {
    readonly theme?: string;
    readonly font_size?: string;
    readonly locale?: string;
    readonly map_layers?: MapLayerChoice;
    readonly filter_tab?: string;
    readonly offline_images?: boolean;
  };
}

export const EMPTY_PREFS_STORE: PrefStore = {};

function canonical(v: Json): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x as Json)).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as { readonly [k: string]: Json };
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k] as Json)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Does `a` beat `b`? Later time wins; an exact tie goes to the larger canonical value, so the result never depends on arrival order. */
function beats(a: { value: Json; at: Instant }, b: { value: Json; at: Instant }): boolean {
  if (a.at !== b.at) return a.at > b.at;
  return canonical(a.value) > canonical(b.value);
}

/**
 * Last write wins per key path. Commutative, associative and idempotent in the edits, so devices that sync in any
 * order and any number of times converge. Pure: the inputs are not changed. Entries are assumed validated
 * (`validatePrefValue`); this function does not refuse anything.
 */
export function mergePrefs(server: PrefStore, localEdits: readonly PrefEntry[]): PrefStore {
  const out: Record<string, { value: Json; at: Instant }> = { ...server };
  for (const e of localEdits) {
    const cur = out[e.path];
    if (cur === undefined || beats(e, cur)) out[e.path] = { value: e.value, at: e.at };
  }
  return out;
}

/** Folds the stored entries into the nested record a participant reads. */
export function prefsOf(store: PrefStore): Prefs {
  const tools: Record<string, boolean> = {};
  const toolPrefs: Record<string, Record<string, Json>> = {};
  const ui: Record<string, Json> = {};
  let saved: readonly SavedFilter[] = [];
  let active: string | null = null;
  let hidden: HiddenFilter | null = null;
  for (const [path, { value }] of Object.entries(store)) {
    const [section, a, b] = path.split('.') as [string, string, string | undefined];
    if (section === 'tools') tools[a] = value as boolean;
    else if (section === 'tool_prefs' && b !== undefined) (toolPrefs[a] ??= {})[b] = value;
    else if (path === 'filters.saved') saved = value as unknown as readonly SavedFilter[];
    else if (path === 'filters.active') active = value as string | null;
    else if (path === 'filters.hidden') hidden = value as unknown as HiddenFilter;
    else if (section === 'ui') ui[a] = value;
  }
  return { tools, tool_prefs: toolPrefs, filters: { saved, active, hidden }, ui: ui as Prefs['ui'] };
}
