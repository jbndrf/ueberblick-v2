/**
 * What the participant switched off in the filter sheet (v3 "Einfach"): whole Objektarten, and single stages of the
 * Objektart's process. Pure and immutable; "hidden" is stored, so a new Objektart or stage is visible by default.
 * Persistence goes through `FilterPrefs`: in memory until the personal preference store (WP-612) lands, then that
 * store implements the same two calls and nothing else changes.
 */
import type { Key } from '@ueberblick/core/model';

export interface FilterState {
  readonly hiddenTypes: ReadonlySet<Key>;
  /** Hidden stage keys per Objektart. */
  readonly hiddenValues: ReadonlyMap<Key, ReadonlySet<string>>;
}

export const emptyFilter: FilterState = { hiddenTypes: new Set(), hiddenValues: new Map() };

/** The type switch of the card: on while the Objektart is not hidden. */
export const typeSwitchOn = (s: FilterState, type: Key): boolean => !s.hiddenTypes.has(type);

export const valueSwitchOn = (s: FilterState, type: Key, value: string): boolean =>
  !(s.hiddenValues.get(type)?.has(value) ?? false);

/** Whether a feature of `type` in `stage` (undefined: the type has no process) is drawn. */
export function isVisible(s: FilterState, type: Key, stage: string | undefined): boolean {
  if (s.hiddenTypes.has(type)) return false;
  return stage === undefined || valueSwitchOn(s, type, stage);
}

/**
 * v3's master switch (`FilterSheet.svelte:316-322`, `+page.svelte:1965-1982`): off switches every stage off, on shows
 * every stage again. `stages` are the Objektart's declared stages (none when it has no process).
 */
export function setTypeVisible(
  s: FilterState,
  type: Key,
  visible: boolean,
  stages: readonly string[] = [],
): FilterState {
  const hiddenTypes = new Set(s.hiddenTypes);
  const hiddenValues = new Map(s.hiddenValues);
  if (visible) {
    hiddenTypes.delete(type);
    hiddenValues.delete(type);
  } else {
    hiddenTypes.add(type);
    if (stages.length > 0) hiddenValues.set(type, new Set(stages));
  }
  return { hiddenTypes, hiddenValues };
}

/** Only the type flag on, stages untouched (v3 "Ensure the new workflow type is visible", `+page.svelte:2352-2354`). */
export function revealType(s: FilterState, type: Key): FilterState {
  if (!s.hiddenTypes.has(type)) return s;
  const hiddenTypes = new Set(s.hiddenTypes);
  hiddenTypes.delete(type);
  return { hiddenTypes, hiddenValues: s.hiddenValues };
}

/**
 * One stage switch. As v3, the type follows its stages: a stage switched on while the type is off shows the type
 * (with only the stages that are on), and the last stage switched off hides the type.
 */
export function setValueVisible(
  s: FilterState,
  type: Key,
  value: string,
  visible: boolean,
  stages: readonly string[] = [],
): FilterState {
  const values = new Set(s.hiddenValues.get(type));
  if (visible) values.delete(value);
  else values.add(value);
  const hiddenValues = new Map(s.hiddenValues);
  if (values.size === 0) hiddenValues.delete(type);
  else hiddenValues.set(type, values);
  const hiddenTypes = new Set(s.hiddenTypes);
  if (visible) hiddenTypes.delete(type);
  else if (stages.length > 0 && stages.every((v) => values.has(v))) hiddenTypes.add(type);
  return { hiddenTypes, hiddenValues };
}

/** Where the switch state is kept per person. */
export interface FilterPrefs {
  /** The person's stored filter, or null when none was ever stored (then the project's start filter applies, A-040). */
  load(): FilterState | null;
  save(state: FilterState): void;
  /** Writes a pending save now (sheet close, page hide). */
  flush?(): void;
}

interface Snapshot {
  readonly types: readonly Key[];
  readonly values: readonly (readonly [Key, readonly string[]])[];
}

/** In-memory prefs (a copy in, a copy out). */
export function memoryPrefs(): FilterPrefs {
  let snap: Snapshot | null = null;
  return {
    load: () =>
      snap === null
        ? null
        : {
            hiddenTypes: new Set(snap.types),
            hiddenValues: new Map(snap.values.map(([t, v]) => [t, new Set(v)])),
          },
    save: (s) => {
      snap = {
        types: [...s.hiddenTypes],
        values: [...s.hiddenValues].map(([t, v]) => [t, [...v]] as const),
      };
    },
  };
}
