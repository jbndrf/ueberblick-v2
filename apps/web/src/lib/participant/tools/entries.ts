/**
 * What the shell knows of the tools of this person, as pure functions of the project file, the role, the person's
 * switches and the problem list: which tools exist for the role (availability), which are on, which the Werkzeuge
 * sheet shows and which the switches in Einstellungen list. The rule "offered is off, active is on, the person's
 * switch wins" is core's `toolIsOn` (R1); nothing here re-decides it.
 */
import type { TemplateFile } from '@ueberblick/core/model';
import { type ToolAvailability, type ToolContribution } from '@ueberblick/core/registry';
import { toolAvailabilityFor, toolIsOn } from '@ueberblick/core/registry/tools';
import type { AppProblem } from '../notices';
import { TOOL_MANIFEST, type ToolManifestEntry } from './manifest';

export interface ToolEntry extends ToolManifestEntry {
  readonly availability: ToolAvailability;
  readonly on: boolean;
}

/** The person's switches (`prefs.tools`). */
export type ToolSwitchMap = Readonly<Record<string, boolean>>;

/** v3's groups of the opt-in panel (`AdvancedFeaturesPanel.svelte:34-38`), in its order; each is a contribution point. */
export const TOOL_GROUPS = ['filter', 'layers', 'tools'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

const GROUP_OF: Readonly<Partial<Record<ToolContribution, ToolGroup>>> = {
  'filter-tab': 'filter',
  'layer-section': 'layers',
  'tools-sheet': 'tools',
};
export const groupOf = (point: ToolContribution): ToolGroup | undefined => GROUP_OF[point];

/**
 * The tools the app hosts that the role has, in manifest order (core's `toolAvailabilityFor`, R1). A role with no `app.tools` (or a role the file does
 * not know) has the project's tools, active, as before this platform; a tool the role lists without `availability` is
 * active (WP-613).
 */
export function toolEntries(
  file: TemplateFile,
  roleKey: string,
  switches: ToolSwitchMap,
): readonly ToolEntry[] {
  const out: ToolEntry[] = [];
  for (const t of TOOL_MANIFEST) {
    const availability = toolAvailabilityFor(file, [roleKey], t.key);
    if (availability === undefined) continue;
    out.push({ ...t, availability, on: toolIsOn(availability, switches[t.key]) });
  }
  return out;
}

/**
 * The tiles of the Werkzeuge sheet: tools that are on, contribute `tools-sheet` and have no invalid setting (that one
 * is reported in the problem bar and not offered). `map: false` also drops the tools that need a tappable map.
 */
export function sheetTools(
  entries: readonly ToolEntry[],
  problems: readonly AppProblem[],
  opts: { readonly map?: boolean } = {},
): readonly ToolEntry[] {
  return entries.filter(
    (t) =>
      t.on &&
      t.contributes.includes('tools-sheet') &&
      (opts.map !== false || !t.needsMap) &&
      !problems.some((p) => p.code === 'tool_setting_invalid' && p.subject === t.key),
  );
}

/** The rows of the switches: every tool the role offers or has on, whether the person has it on or off. */
export function switchableTools(entries: readonly ToolEntry[]): readonly ToolEntry[] {
  return entries.filter((t) => t.contributes.some((c) => groupOf(c) !== undefined));
}

/** The tool of the filter sheet's Ansichten tab (WP-665, v3 `filter.field_filters`). */
export const VIEWS_TOOL = 'views';

/** Is this tool on for this person: the role has it, and the person's switch or its availability says so. */
export function isToolOn(file: TemplateFile, roleKey: string, switches: ToolSwitchMap, key: string): boolean {
  return toolEntries(file, roleKey, switches).some((t) => t.key === key && t.on);
}
