/**
 * What the Ansichten tab lists (WP-648). The role's presets come from the project file (`roles.<r>.app.filter_presets`,
 * WP-640); the person's saved filters from the preferences (`filters.saved`, WP-612). The tab itself is offered only
 * when the shell gives this port: it is the seam where tool availability (WP-613) switches the tab on.
 */
import { localize } from '@ueberblick/ui';
import type { FilterSource } from '@ueberblick/core/filters';
import type { TemplateFile } from '@ueberblick/core/model';
import type { SavedFilter } from '@ueberblick/core/prefs';
import type { ActiveView } from './filter-controller';

export interface PresetEntry {
  readonly key: string;
  readonly label: string;
}

export interface SavedEntry {
  readonly id: string;
  readonly name: string;
}

export interface FilterViews {
  readonly presets: readonly PresetEntry[];
  /** The person's saved filters; the section stays out when the person cannot keep any (no `save`). */
  readonly saved?: readonly SavedEntry[];
  readonly save?: (name: string) => void;
  readonly rename?: (id: string, name: string) => void;
  readonly remove?: (id: string) => void;
}

/** The role's presets (`roles.<r>.app.filter_presets`, WP-640), in file order. */
export function presetsOf(file: TemplateFile, roleKey: string, locale: string): readonly PresetEntry[] {
  const presets = file.roles?.[roleKey]?.app?.filter_presets ?? {};
  return Object.entries(presets).map(([key, p]) => ({ key, label: localize(p.label, locale) }));
}

/** The filter of the active view: the role's preset or one of the person's saved filters. */
export function filtersOfView(
  file: TemplateFile,
  roleKey: string,
  saved: readonly SavedFilter[],
  view: ActiveView,
): FilterSource | undefined {
  return view.kind === 'preset'
    ? file.roles?.[roleKey]?.app?.filter_presets?.[view.key]?.filters
    : saved.find((s) => s.id === view.key)?.filters;
}

/**
 * What the Ansichten tab offers (WP-808, Q20): the role's presets are shown to everyone in the role, whether or not the
 * Ansichten tool is on; the person's own saved views need the tool (`own`). No presets and no tool: no tab at all.
 */
export function viewsOffered(
  presets: readonly PresetEntry[],
  own: FilterViews | undefined,
): FilterViews | undefined {
  if (own !== undefined) return own;
  return presets.length > 0 ? { presets } : undefined;
}
