import { defineRegistry, type KeyOf } from './define';

/**
 * The enum values of the personal preference record (WP-612, `packages/core/src/prefs`). R6: the values live here,
 * the module imports them.
 */

/** The colour scheme a participant picks in Einstellungen (v3 `stores/theme.svelte.ts`). */
export const PREF_THEMES = defineRegistry([
  { key: 'light', description: 'Light colours.' },
  { key: 'dark', description: 'Dark colours.' },
] as const);
export type PrefTheme = KeyOf<typeof PREF_THEMES>;

/** The text sizes of Einstellungen (v3 `stores/font-size.svelte.ts`). */
export const PREF_FONT_SIZES = defineRegistry([
  { key: 'xs', description: 'Extra small (12 px).' },
  { key: 'small', description: 'Small (14 px).' },
  { key: 'medium', description: 'Medium (16 px), the default.' },
  { key: 'large', description: 'Large (18 px).' },
  { key: 'xl', description: 'Extra large (20 px).' },
] as const);
export type PrefFontSize = KeyOf<typeof PREF_FONT_SIZES>;

/** The top-level sections of the record; a key path starts with one of them. */
export const PREF_SECTIONS = defineRegistry([
  { key: 'tools', description: 'tools.<key>: a boolean, the tool is switched on for this person.' },
  { key: 'tool_prefs', description: 'tool_prefs.<tool>.<name>: one preference of one tool, any JSON value.' },
  { key: 'filters', description: 'filters.saved (the saved filters) and filters.active (the active one).' },
  { key: 'ui', description: 'ui.theme, ui.font_size, ui.locale.' },
] as const);
export type PrefSection = KeyOf<typeof PREF_SECTIONS>;
