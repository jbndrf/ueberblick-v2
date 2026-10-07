import { defineRegistry, type KeyOf } from './define';
import type { PropertyTypeKey } from './property-types';

// Registries for the design system (packages/ui). R6: enum values live only here.

/** Themes the token mechanism emits (docs/13 principles 9 and 10). */
export const THEME_NAMES = defineRegistry([
  { key: 'normal', description: 'Default theme, WCAG 2.2 AA (4.5:1 text).' },
  { key: 'outdoor', description: 'High-contrast theme for sunlight, at least 7:1 text.' },
] as const);
export type ThemeName = KeyOf<typeof THEME_NAMES>;

/** Button emphasis. */
export const BUTTON_VARIANTS = defineRegistry([
  { key: 'primary', description: 'The one main action of a screen.' },
  { key: 'secondary', description: 'A supporting action.' },
  { key: 'danger', description: 'A destructive action.' },
] as const);
export type ButtonVariant = KeyOf<typeof BUTTON_VARIANTS>;

/** Honest state shown by StatusBadge (docs/13 principle 8). */
export const STATUS_KINDS = defineRegistry([
  { key: 'online', description: 'Connected, everything is synced.' },
  { key: 'offline', description: 'No connection; work is kept on the device.' },
  { key: 'pending', description: 'Runs are waiting to be synced.' },
  { key: 'refused', description: 'The server refused a run; needs attention.' },
] as const);
export type StatusKind = KeyOf<typeof STATUS_KINDS>;

/** Whether the device may lose its unsent data (WP-522; from `navigator.storage.persist()`/`estimate()`). */
export const STORAGE_STATES = defineRegistry([
  { key: 'ok', description: 'Storage is persistent and has room.' },
  { key: 'at_risk', description: 'The browser may evict the data, or the quota is nearly full.' },
] as const);
export type StorageState = KeyOf<typeof STORAGE_STATES>;

/** Kinds of node in the participant app navigation graph (docs/ia-map.md). */
export const NAV_NODE_KINDS = defineRegistry([
  { key: 'area', description: 'Level 1: a top-level area.' },
  { key: 'section', description: 'Level 2: one sub-level of an area.' },
  { key: 'sheet', description: 'In-place disclosure (sheet); not a navigation level.' },
] as const);
export type NavNodeKind = KeyOf<typeof NAV_NODE_KINDS>;

/** Sections of the participant "Me" area (docs/ia-map.md). */
export const ME_SECTIONS = defineRegistry([
  { key: 'profile', description: 'The participant profile.' },
  { key: 'settings', description: 'Personal settings such as language and theme.' },
  { key: 'offline_packs', description: 'Offline packs kept on the device.' },
] as const);
export type MeSection = KeyOf<typeof ME_SECTIONS>;

/** Where a tool plugs into the app (tool platform v2, tool-platform.md §3.3). A tool declares the points it
 * contributes to; the host mounts it only there. New points append here (H1 viewers, H5 live layers). */
export const TOOL_CONTRIBUTIONS = defineRegistry([
  { key: 'tools-sheet', description: 'An entry in the Werkzeuge sheet that opens the tool panel.' },
  { key: 'filter-tab', description: 'A tab in the Filter sheet.' },
  { key: 'layer-section', description: 'A section in the Layer sheet.' },
  { key: 'feature-action', description: 'An entry in the feature sheet menu.' },
  {
    key: 'settings-section',
    description: 'The tool preferences in Einstellungen, Optionen, Werkzeuge.',
  },
  {
    key: 'form-field',
    description: 'Mounts in a task-sheet field slot and produces the form value of that field.',
  },
] as const);
export type ToolContribution = KeyOf<typeof TOOL_CONTRIBUTIONS>;

/** How a role has a tool (owner answer "Tool levels": two levels, no "required"). An absent tool does not
 * exist for the role. New levels append here. */
export const TOOL_AVAILABILITY = defineRegistry([
  { key: 'offered', description: 'Off at first; the person may switch it on.' },
  { key: 'active', description: 'On at first; the person may switch it off.' },
] as const);
export type ToolAvailability = KeyOf<typeof TOOL_AVAILABILITY>;

/** The value kinds of a tool option (settings the admin sets, preferences the person sets). */
export const TOOL_OPTION_TYPES = defineRegistry([
  { key: 'boolean', description: 'A switch.' },
  { key: 'string', description: 'A text.' },
  { key: 'number', description: 'A number, optionally bounded.' },
  { key: 'integer', description: 'A whole number, optionally bounded.' },
  { key: 'select', description: 'One of a fixed list of strings.' },
  { key: 'string_list', description: 'A list of texts.' },
] as const);
export type ToolOptionType = KeyOf<typeof TOOL_OPTION_TYPES>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The property types a `field` tool can produce, each with the shape check of its value. Keyed by
 * `PropertyTypeKey` (a key outside the property type registry is a type error). New types append here. */
export const PRODUCIBLE_SHAPES = {
  /** A file value is a list of `{ sha256, name, mime }` (WP-603). */
  file: (v: unknown): boolean =>
    Array.isArray(v) &&
    v.every(
      (f: unknown) =>
        isObject(f) &&
        typeof f.sha256 === 'string' &&
        /^[0-9a-f]{64}$/.test(f.sha256) &&
        typeof f.name === 'string' &&
        typeof f.mime === 'string',
    ),
  geometry: (v: unknown): boolean => isObject(v) && typeof v.type === 'string',
} as const satisfies Partial<Record<PropertyTypeKey, (v: unknown) => boolean>>;
export type ProducibleType = keyof typeof PRODUCIBLE_SHAPES;

export const TOOL_HOST_ERROR_CODES = defineRegistry([
  { key: 'unknown_tool', description: 'No tool is registered under this key.' },
  { key: 'wrong_point', description: 'The tool does not contribute to this point.' },
  { key: 'tool_off', description: 'The tool is absent for the role, or the person switched it off.' },
  { key: 'invalid_preference', description: 'A preference is not in the tool schema or has a wrong value.' },
  { key: 'wrong_field_type', description: 'The tool produces another property type than the field has.' },
  { key: 'invalid_value', description: 'The produced value does not have the shape of the property type.' },
  { key: 'unmounted', description: 'The tool produced a value after it was unmounted.' },
  { key: 'invalid_option', description: 'A tool option is present but has an invalid value.' },
  {
    key: 'invalid_definition',
    description: 'defineTool was given a definition that breaks the tool contract.',
  },
  {
    key: 'unsupported_api',
    description: 'The tool was defined against another tool API version than the host.',
  },
] as const);
export type ToolHostErrorCode = KeyOf<typeof TOOL_HOST_ERROR_CODES>;

/** What the task sheet says about a submitted run (WP-526).
 * `accepted` is the only state that means "done": it comes from the server, never from the sheet. */
export const RUN_PROGRESS_STATES = defineRegistry([
  { key: 'queued', description: 'Saved on this device; the run queue will send it.' },
  { key: 'accepted', description: 'The server accepted the run.' },
  { key: 'refused', description: 'The server refused the run; the progress carries the reason.' },
] as const);
export type RunProgressState = KeyOf<typeof RUN_PROGRESS_STATES>;
