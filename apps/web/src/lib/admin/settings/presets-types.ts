/** What the Filter & Felder section shows of the filter presets (WP-386). Plain data: it crosses from the server. */
import type { CompiledConfigData } from '@ueberblick/core/hydrate';

/**
 * One preset as the list shows it: v3 had one project-wide list; v4 keeps a preset per role
 * (`roles.<r>.app.filter_presets.<key>`, owner decision 3), so a row is the roles that hold the same preset.
 */
export interface PresetRow {
  readonly key: string;
  readonly label: string;
  /** The role keys that have this preset (identical name and filter). */
  readonly roles: readonly string[];
  /** One rule-language expression per feature type (`FilterSource` of `core/filters`). */
  readonly filters: Readonly<Record<string, string>>;
  /** v3's "N Bedingung(en)": the rows the filter builder shows for it. */
  readonly conditions: number;
}

export interface RoleOption {
  readonly key: string;
  readonly label: string;
}

/** What the section needs, loaded when it opens (the draft's effective file, compiled for the builder). */
export interface FiltersData {
  readonly roles: readonly RoleOption[];
  readonly presets: readonly PresetRow[];
  /** The compiled draft: the filter builder offers its types, fields and stages (core `builderContext`). */
  readonly config: CompiledConfigData;
}

/** A preset to write: `key` and `was` name the preset being edited (absent: a new one). */
export interface PresetSave {
  readonly name: string;
  readonly roles: readonly string[];
  readonly filters: Readonly<Record<string, string>>;
  readonly key?: string;
  /** The roles the edited preset had before; roles dropped from `roles` lose it. */
  readonly was?: readonly string[];
}

export interface PresetRef {
  readonly key: string;
  readonly roles: readonly string[];
}
