import type { GeoValidityIssue } from '@ueberblick/core/registry';

/** Strings come from the app (Paraglide); the drawing controls have no literal text (as `MapDescriptionLabels`). */
export interface DrawLabels {
  /** Name of the group of buttons (v3: "Zeichenwerkzeug"). */
  readonly toolbar: string;
  readonly cancel: string;
  readonly newPart: string;
  /** Name of the tab of part `n` (1-based; v3: "Element 1"). */
  readonly part: (n: number) => string;
  readonly undo: string;
  readonly redo: string;
  readonly delete: string;
  readonly finish: string;
  /** The refusal shown when Fertig is pressed on invalid geometry; `reason` is one of `issues`. */
  readonly refused: (reason: string) => string;
  /** Why core.geo refused: one word per issue of the registry, so a new issue fails to compile until it has words. */
  readonly issues: Readonly<Record<GeoValidityIssue, string>>;
}
