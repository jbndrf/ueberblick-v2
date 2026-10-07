/**
 * What a view lets through (WP-648, Q20): a role preset or a saved filter is one rule-language expression per
 * Objektart (`core/filters`), evaluated on the device and clipped by permissions. `viewPass` compiles it once; the
 * result answers per feature, which is what the map's filtered source needs.
 */
import { applyFilter, compileFilter, type FilterEnv, type FilterSource } from '@ueberblick/core/filters';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Actor, FeatureState } from '@ueberblick/core/model';
import { compilePerms } from '@ueberblick/core/perms';
import type { SavedFilter } from '@ueberblick/core/prefs';
import type { PrefsClient } from '@ueberblick/client';
import type { Reader } from '../../reader';
import { isToolOn, VIEWS_TOOL } from '../../tools/entries';
import { filtersOfView } from './filter-views';
import type { ViewPassOf } from './filtered-source';

export type ViewPass = (state: FeatureState) => boolean;

/** The predicate of one view, or undefined when its filter does not compile (a wrong preset is reported at compile). */
export function viewPass(env: FilterEnv, filters: FilterSource): ViewPass | undefined {
  const compiled = compileFilter(env.config, filters);
  if (!compiled.ok) return undefined;
  const { filter } = compiled;
  return (state) => applyFilter(env, filter, state.type, [state]).length > 0;
}

/** What the active view needs of the device: the compiled config, the actor and the expression context. */
export interface ViewDevice {
  readonly config: CompiledConfig;
  readonly actor: Actor;
  readonly roleKey: string | undefined;
  readonly reader: Pick<Reader, 'taskContext'>;
}

/**
 * The map's `viewPassOf` (WP-648): finds the filters of the active view (the role's preset in the project file, or
 * the person's saved filter in the preference record) and compiles them against the device's permissions.
 * `enabled` is the Ansichten tool's switch (WP-665, v3 `+page.svelte:1771`): while the tool is off the person's saved
 * views do not apply. The role's presets are the admin's and apply for everyone in the role (Q20, WP-808).
 */
export function deviceViewPassOf(
  device: ViewDevice,
  saved: () => readonly SavedFilter[],
  enabled: () => boolean = () => true,
): ViewPassOf {
  return (view) => {
    if (view.kind === 'saved' && !enabled()) return undefined;
    const filters = filtersOfView(device.config.file, device.roleKey ?? '', saved(), view);
    if (filters === undefined) return undefined;
    return viewPass(
      {
        config: device.config,
        perms: compilePerms(device.config),
        actor: device.actor,
        ctx: device.reader.taskContext(),
      },
      filters,
    );
  };
}

/** The map's and Zuletzt's `viewPassOf`, read from the person's record (R1: the one wiring of both). */
export const recordViewPassOf = (device: ViewDevice, record: Pick<PrefsClient, 'current'>): ViewPassOf =>
  deviceViewPassOf(
    device,
    () => record.current().filters.saved,
    () => isToolOn(device.config.file, device.roleKey ?? '', record.current().tools, VIEWS_TOOL),
  );
