/**
 * The builder document model (docs/08-builder.md "Document model").
 * CONTRACT for WP-200; consumed by the builder UI, the MCP server (WP-211) and assistants (H4).
 * Headless: no DOM, no I/O. Every edit lands in the overlay (docs/05: an edit is an overlay entry).
 * A Doc is immutable: `apply` returns a new Doc, the old one stays valid (undo = keep the old one).
 */
import type { RefusalCode } from './refusal-codes';
import type { KeyPath, OverlayFile, Problem, Provenance, TemplateFile } from '@ueberblick/core';

/**
 * One edit. `set` changes a value the template has (an `override` entry) or a value inside an
 * added entity (edited in place in its `add` entry); `add` creates an entity (an `add` entry);
 * `hide` / `unhide` toggle a `hide` entry; `reset` drops the overlay entry at exactly `path`; `reset` and `hide` also drop the `order` of a map at or below `path` (nothing left to order, WP-477); `order` writes `order.<path>`, the keys of the map at `path` that
 * come first (core's merge validates it: an unknown map or key refuses the op).
 * Paths are key paths (A-005). `set` on `inputs.<key>` writes the overlay's `inputs`.
 */
export type Op =
  | { readonly kind: 'set'; readonly path: KeyPath; readonly value: unknown }
  | { readonly kind: 'add'; readonly path: KeyPath; readonly value: unknown }
  | { readonly kind: 'hide'; readonly path: KeyPath }
  | { readonly kind: 'unhide'; readonly path: KeyPath }
  | { readonly kind: 'reset'; readonly path: KeyPath }
  | { readonly kind: 'order'; readonly path: KeyPath; readonly keys: readonly string[] };

/** Why an op did not take effect (`ApplyResult.refused`, `ReplaceResult.refused`, `ApplyOpsResult.refused`). */
export interface Refusal {
  readonly path: KeyPath;
  /** English, for logs and assistants; the admin reads the text of `code` (or of `problems`), never this. */
  readonly message: string;
  readonly code: RefusalCode;
  /** Values the code's wording names (`path`, `shown`). */
  readonly params?: Readonly<Record<string, string>>;
  /** The checker problems the edit would have added (`schema`, `dead_entry`): their localized text is the reason. */
  readonly problems?: readonly Problem[];
}

export interface ApplyResult {
  /** The document after the op; the same Doc when the op changed nothing. */
  readonly doc: Doc;
  /** Problems of the whole effective file after the op (merge issues, then compile). */
  readonly problems: readonly Problem[];
  /**
   * Set when the op was refused and the doc is unchanged, so an op never silently does nothing (R11):
   * the path is not a key path; the op would make the effective file break the file schema; the
   * effective file would not take the value (the path is hidden, a parent does not allow it, the
   * template locks it); or an earlier edit made a parent a single value (`reset` it first).
   * `set` on a path the template lacks is written as an `add` by `apply` itself; a lens sends `set`
   * for "change this value" and never has to choose. `reset` and `unhide` of something not there
   * are not refusals: the state asked for already holds.
   */
  readonly refused?: Refusal;
}

/**
 * The outcome of `applyOps`: the last Doc and the problems of its effective file when every op took
 * effect, or the first refusal when one did not (nothing applied; the original Doc is unchanged).
 */
export type ApplyOpsResult =
  { readonly doc: Doc; readonly problems: readonly Problem[] } | { readonly refused: Refusal };

export interface ReplaceResult {
  /** The Doc with the new overlay text; the same Doc when refused or when the text is what it already saves. */
  readonly doc: Doc;
  /** Problems of the whole effective file for the new overlay (unchanged when refused). */
  readonly problems: readonly Problem[];
  /** Set when the text does not parse, does not fit the overlay file schema or extends another template; `path` is empty. */
  readonly refused?: Refusal;
}

export interface SaveResult {
  /** The overlay file text: byte-identical to the opened text when nothing changed. */
  readonly overlaySrc: string;
  /** Revision of `overlaySrc`; pass it as `expected` of a later `saveIf` on a doc opened from it. */
  readonly revision: string;
}

export type SaveIfResult =
  | (SaveResult & { readonly ok: true; readonly doc: Doc })
  | {
      readonly ok: false;
      readonly reason: 'stale_revision';
      readonly expected: string;
      readonly opened: string;
    };

/** One line of an entity's YAML: the deepest key path it belongs to and where that comes from. */
export interface EntityYamlLine {
  /** 1-based. */
  readonly line: number;
  readonly path: KeyPath;
  readonly provenance: Provenance;
}

export interface EntityYaml {
  readonly text: string;
  /** One entry per line of `text`. */
  readonly lines: readonly EntityYamlLine[];
}

/** A problem of typed entity YAML; `line` and `column` (1-based) are set when it points into the text. */
export type EntityYamlProblem = Problem & { readonly line?: number; readonly column?: number };

export type EntityYamlResult =
  | { readonly ok: true; readonly ops: readonly Op[] }
  | { readonly ok: false; readonly problems: readonly EntityYamlProblem[] };

export interface Doc {
  /** The template as opened; never modified by any op. */
  readonly template: TemplateFile;
  readonly templateSrc: string;
  /** Revision of the overlay text this Doc was opened from (or last saved with). */
  readonly revision: string;
  /** True once an op has changed the overlay. */
  readonly dirty: boolean;
  /** The overlay as data. */
  overlay(): OverlayFile;
  /** `template.merge(template, overlay).file`. */
  effective(): TemplateFile;
  /**
   * The one problems list, in the order the panel shows it: merge problems, then compile problems
   * and warnings. A file that breaks the file schema is not compiled; it has `schema_invalid` problems
   * instead, and `apply` refuses an op that turns a valid file invalid.
   */
  problems(): readonly Problem[];
  /** Where the element at `path` comes from; an element inside an added entity is `added`. */
  provenance(path: KeyPath): Provenance;
  apply(op: Op): ApplyResult;
  /**
   * Replace the whole overlay by typed text (the YAML lens). The text is validated like `openProject`
   * and kept byte for byte by `save()` (comments, order, layout) until the next op. The effective file
   * may have problems; they are returned like after any op.
   */
  replaceOverlay(text: string): ReplaceResult;
  /**
   * Applies several ops as one edit: each op is checked on its own (not a key path, locked, hidden or
   * missing path, ineffective) but the file schema only on the END state, so ops that are invalid one
   * by one (a `form` and its form step) can go together. All or none: the first refusal returns it
   * and this Doc is unchanged; on success the last Doc (immutable, one step of undo for the batch).
   */
  applyBatch(ops: readonly Op[]): ApplyOpsResult;
  /**
   * The effective YAML of one entity (`types.<t>`, `tasks.<k>`, `rules.<k>`, `types.<t>.properties.<p>`)
   * with the provenance of every line (the Code view). Empty text and lines for another path.
   */
  entityYaml(path: KeyPath): EntityYaml;
  /**
   * Turns an edited `entityYaml` text into the minimal overlay ops (one `set` per changed value, `add`
   * for a new key, `hide` for a deleted template key, `reset` for a deleted added key or a value set back
   * to the template's). Applies nothing: it returns the ops after a trial fold, which the caller applies
   * with `applyOps(doc, ops)`. That folds the ops over `apply` and adopts only the last Doc, so the batch
   * is all or none: a refusal at any step drops the whole fold and leaves the original Doc untouched
   * (a Doc is immutable); the ops were already tried in order on this Doc, so a refusal there is not
   * expected. A problem (bad YAML with line and column, a locked path, an op `apply` would refuse, new
   * compile problems) means `ok: false`.
   */
  applyEntityYaml(path: KeyPath, text: string): EntityYamlResult;
  /** The overlay text and its revision. */
  save(): SaveResult;
  /**
   * Save when the store's current revision (`expected`) is the one this Doc was opened from; else
   * refuse, so a stale editor cannot overwrite a newer save. On success the returned Doc is
   * rebased on the new revision.
   */
  saveIf(expected: string): SaveIfResult;
}

/** Thrown by `openProject` when a source does not parse or does not fit together. */
export class DocOpenError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'DocOpenError';
  }
}

export interface DocApi {
  openProject(templateSrc: string, overlaySrc: string): Doc;
}
