/**
 * Server import and export (WP-111). CONTRACT: changes need the lead.
 *
 * **Import is runs (R3).** A file becomes runs of one creating task with an actor of kind `import`; they go through
 * `Store.submitBatch` (from `projectStoresFor(runtime)`), so plan, rules, hooks, timers and the doorbell all apply.
 * There is no direct row write. Text is NFC-normalised; geometry is reprojected to WGS84 by `core.geo` (Z kept, H1).
 *
 * **Rows.** A row is a 1-based record number: the data row of a CSV (header excluded), the feature of a GeoJSON
 * collection, the row of the GeoPackage layer in rowid order. Problems name it.
 *
 * **Modes** (`IMPORT_MODES`). `atomic` (default): any problem, in the file or in plan, refuses everything and writes
 * nothing. `skip`: rows with a problem are reported and left out; the others are submitted one run at a time, so a
 * plan refusal skips just that row and reports it.
 *
 * **Seam for WP-301.** `planRows` takes rows already read, so the v3 converter feeds it without a file.
 */
import type {
  Actor,
  CompiledConfig,
  Geo,
  GeoSourceCrs,
  Geometry,
  Ids,
  Instant,
  Json,
  Key,
  Run,
} from '@ueberblick/core';
import type { ImportFormat, ImportMode, ImportProblemCode } from './registry';

/** The file's bytes (or text), or for a GeoPackage a path, so a large file is never held in memory. */
export type ImportSource =
  | { readonly format: ImportFormat; readonly data: Uint8Array | string }
  | { readonly format: 'geopackage'; readonly path: string };

/** One source column mapped onto a form field of the creating task. `language` is required for localized text. */
export type FieldMapping = string | { readonly column: string; readonly language?: string };

export interface ImportMapping {
  /** The task that `creates` the feature type. */
  readonly task: Key;
  /**
   * With `task: '$create'` (a Tabelle, WP-433): the type whose rows these are. Each row is a `$create` run (the admin's
   * way to add a row), `fields` are property keys and there is no geometry.
   */
  readonly type?: Key;
  /** Form field key of the task -> source column (CSV header, GeoJSON property name, GeoPackage column). */
  readonly fields: Readonly<Record<string, FieldMapping>>;
  /**
   * Property -> value written on every imported feature, the process stage included ('In Stufe importieren'). With
   * constants a row is a `$import` run (core plan checks each one: an unknown property or a value that does not fit
   * refuses the row); without, a plain run of `task`.
   */
  readonly constants?: Readonly<Record<string, Json>>;
  /** The form field that receives the geometry. CSV also names its coordinate columns. */
  readonly geometry?: {
    readonly field: string;
    readonly x?: string;
    readonly y?: string;
    readonly z?: string;
  };
  /** Required unless the file declares one (GeoPackage srs, GeoJSON `crs` member). Else `crs_undeclared`. */
  readonly sourceCrs?: GeoSourceCrs;
  /** GeoPackage: the feature table to read; default the first one. */
  readonly layer?: string;
  /** CSV: the field separator; default detected from the header (`;` or `,`). */
  readonly delimiter?: string;
}

export interface ImportDeps {
  readonly config: CompiledConfig;
  readonly configVersion: number;
  /** Kind `import`. It is not bound by role allowlists, but a task's `when` still applies to it. */
  readonly actor: Actor;
  readonly ids: Ids;
  readonly geo: Geo;
  readonly clientTime?: Instant;
}

/** A source row after reading: raw attribute values by column name, and the geometry as read (in its source CRS). */
export interface ImportRow {
  readonly row: number;
  readonly values: Readonly<Record<string, Json>>;
  readonly geometry?: Geometry;
  /** Set by a reader that could not make a row of the record; the row is a problem, not a run. */
  readonly problem?: { readonly code: ImportProblemCode; readonly message: string };
}

export interface ImportProblem {
  readonly row: number;
  /** An `IMPORT_PROBLEM_CODES` key, or a `REFUSAL_CODES` key when plan refused the row. */
  readonly code: ImportProblemCode | string;
  readonly message: string;
  readonly path?: string;
}

export interface ImportPlan {
  /** Ready to submit; empty in `atomic` mode when there are problems. */
  readonly runs: readonly Run[];
  /** The source row of each run, parallel to `runs`. */
  readonly rows: readonly number[];
  readonly problems: readonly ImportProblem[];
}

export type ImportOutcome =
  | { readonly outcome: 'accepted'; readonly imported: number; readonly problems: readonly ImportProblem[] }
  | { readonly outcome: 'refused'; readonly problems: readonly ImportProblem[] };

export interface ImportOptions {
  readonly mode?: ImportMode;
}

/** What a reader yields: the rows (lazily), plus the CRS the file declares, if it does. */
export interface ReadResult {
  readonly rows: Iterable<ImportRow>;
  readonly declaredCrs?: GeoSourceCrs;
  /** Frees what the reader holds (an open database, a temporary file). Called once, after the rows are used. */
  readonly dispose?: () => void;
}
