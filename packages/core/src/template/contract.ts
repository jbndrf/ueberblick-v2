/**
 * Template merge, overlay and upgrade (F13, docs/05-config-format.md, decision 0009).
 * CONTRACT — written by the lead; changes need the lead. Implemented by WP-012.
 * All functions are pure. Paths are dotted key paths into the file, e.g.
 * `types.baum.properties.vitalitaet.label` — the same addressing the overlay uses.
 */
import type { Provenance, TemplateBreakingKind, TemplateIssueCode } from '../registry/admin';
import type { OverlayFile, TemplateFile } from '../schema';
import type { ProblemParams } from '../schema/compile/contract';

/** A key path into a template or effective config (A-005 grammar: bare key segments, other segments as bracketed JSON strings); build and read it only with `formatKeyPath`/`parseKeyPath`. */
export type KeyPath = string;

/** A lock or reference problem found while merging; `compile()` turns these into Problems. */
export interface MergeIssue {
  readonly path: KeyPath;
  readonly code: TemplateIssueCode;
  readonly message: string;
  /** The values `message` is made of; `variant` picks the wording (registry PROBLEM_VARIANTS). */
  readonly params: ProblemParams;
}

export interface MergeResult {
  /** Effective config: the template with inputs, overrides, additions and hides applied. */
  readonly file: TemplateFile;
  /** Provenance for every overridden or added path (template paths are implicit). */
  readonly provenance: ReadonlyMap<KeyPath, Provenance>;
  readonly issues: readonly MergeIssue[];
}

/** A key both the new template and the overlay changed (upgrade table row 3). */
export interface UpgradeConflict {
  readonly path: KeyPath;
  readonly base: unknown;
  readonly theirs: unknown; // new template
  readonly ours: unknown; // overlay
}

export interface UpgradeResult {
  /** The overlay rewritten against the new template; conflicting keys keep the overlay value. */
  readonly overlay: OverlayFile;
  readonly conflicts: readonly UpgradeConflict[];
  /** Template changes that applied automatically (row 1). */
  readonly autoApplied: readonly KeyPath[];
  /** Referenced keys the new template removed without a shipped migration (row 4). */
  readonly unresolved: readonly KeyPath[];
}

export interface BreakingChange {
  readonly path: KeyPath;
  readonly kind: TemplateBreakingKind;
  readonly message: string;
}

export interface TemplateApi {
  merge(template: TemplateFile, overlay: OverlayFile): MergeResult;
  upgrade(oldTemplate: TemplateFile, overlay: OverlayFile, newTemplate: TemplateFile): UpgradeResult;
  /** Changes that a minor version may not contain (docs/05 "Minor versions"). */
  breakingChanges(a: TemplateFile, b: TemplateFile): readonly BreakingChange[];
}
