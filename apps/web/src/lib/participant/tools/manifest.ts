/**
 * The static tool manifest (tool-platform 3.3, WP-613 follow-up): which tools the app hosts, where each plugs in and
 * what the shell needs to know about it without loading its code. Tool code stays lazy (`../tools.ts`
 * `toolLoaders`); the Werkzeuge sheet and the switches in Einstellungen read only this. A new tool is one line here
 * and one `tool_<key>_name` / `tool_<key>_description` pair in the catalogue (R13: no shell change).
 *
 * Field tools (photo, draw) are not listed: they live in a form field, are never switched by a person and have no tile.
 */
import type { ToolContribution } from '@ueberblick/core/registry';

export interface ToolManifestEntry {
  readonly key: string;
  readonly contributes: readonly ToolContribution[];
  /** Name of the tile icon (`icons.ts`). */
  readonly icon: string;
  /** Needs a visible, tappable map (Measure reads taps); not offered while the list stands in for the map. */
  readonly needsMap: boolean;
  /**
   * Reads taps on the map. Its panel is not modal: a modal sheet's scrim would take the very taps the tool needs
   * (WP-585), so the map stays tappable above it.
   */
  readonly readsMapTaps: boolean;
  /** The tool keeps a data stream on the device (`ctx.data`, B-020): the device pulls and sends it, and the shell counts its badge. */
  readonly data?: true;
  /**
   * Its panel is v3's non-modal side panel (`ChatSheet.svelte:411-441`) instead of the Werkzeuge sheet's: it stays
   * open beside the map and the feature sheet.
   */
  readonly aside?: true;
}

export const TOOL_MANIFEST: readonly ToolManifestEntry[] = [
  { key: 'measure', contributes: ['tools-sheet'], icon: 'ruler', needsMap: true, readsMapTaps: true },
  { key: 'search', contributes: ['tools-sheet'], icon: 'search', needsMap: false, readsMapTaps: false },
  // Projekt-Chat (B-020, WP-684): v3's only Werkzeuge tile. Its stream is on the device, its panel is a side panel.
  {
    key: 'chat',
    contributes: ['tools-sheet'],
    icon: 'message-square',
    needsMap: false,
    readsMapTaps: false,
    data: true,
    aside: true,
  },
  // Ansichten (WP-665, v3 `filter.field_filters`): the Ansichten tab of the filter sheet. A filter-tab tool has no tile.
  { key: 'views', contributes: ['filter-tab'], icon: 'bookmark', needsMap: false, readsMapTaps: false },
  // v3 `tools.cluster`: a tab of Karteninhalt (WP-666), no tile in Werkzeuge.
  { key: 'cluster', contributes: ['filter-tab'], icon: 'sparkles', needsMap: true, readsMapTaps: false },
];

export const manifestOf = (key: string): ToolManifestEntry | undefined =>
  TOOL_MANIFEST.find((t) => t.key === key);

/** The tools that keep a data stream on the device: what the device pulls (when the person has them) and the badge counts. */
export const dataToolKeys = (): readonly string[] => TOOL_MANIFEST.filter((t) => t.data).map((t) => t.key);
