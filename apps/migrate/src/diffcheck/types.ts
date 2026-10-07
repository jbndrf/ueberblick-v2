/** Shapes of the differential check: recorded v3 runs in, differences out. */
import type { DiffCause, DiffKind, RecordedOutcome } from './registry';

/** A stored v3 value of a field: text, number, boolean or a list (multiple choice); empty is `null` or `''`. */
export type V3Value = string | number | boolean | null | readonly string[];

export interface V3RelatedInstance {
  readonly stage?: string;
  readonly status?: string;
  readonly values?: Readonly<Record<string, V3Value>>;
}

export interface V3Instance {
  /** The stage key before the run. */
  readonly stage: string;
  /** The instance status (`active`, `completed`, ...). */
  readonly status?: string;
  /** The participant who created it (for ownership conditions). */
  readonly createdBy?: string;
  /** Field key to the latest stored value. */
  readonly values: Readonly<Record<string, V3Value>>;
  /** Instances behind an `instance_reference` field, by field key (for `related` conditions). */
  readonly related?: Readonly<Record<string, readonly V3RelatedInstance[]>>;
}

/** What v3 recorded for a run. */
export interface V3Recorded {
  readonly outcome: RecordedOutcome;
  /** Free text of the v3 refusal. Shown in the report, never compared. */
  readonly reason?: string;
  /** Field key to the value after the run (only the fields worth comparing). */
  readonly values?: Readonly<Record<string, V3Value>>;
  /** The stage key after the run. */
  readonly stage?: string;
  /** Why v4 is expected to differ on this run, and what follows from it. Used only when a difference is found. */
  readonly known?: string;
}

/** One recorded v3 task run. Without `instance` the run is an entry task that creates one. */
export interface V3Run {
  readonly id: string;
  /** The v3 workflow key (or custom table key). */
  readonly workflow: string;
  /** The v3 task key. */
  readonly task: string;
  readonly actor: { readonly id: string; readonly roles: readonly string[] };
  /** The instance before the run; absent for an entry task. */
  readonly instance?: V3Instance;
  /** The submitted values by field key. */
  readonly input?: Readonly<Record<string, V3Value>>;
  /** GeoJSON position for an entry task; a point at 0,0 when absent. */
  readonly geometry?: { readonly type: string; readonly coordinates: unknown };
  /** The time of the run in ms since the epoch (rules read it); a fixed default when absent. */
  readonly now?: number;
  readonly recorded: V3Recorded;
}

export interface Difference {
  readonly runId: string;
  readonly kind: DiffKind;
  readonly cause: DiffCause;
  /** What v3 recorded, in one short phrase. */
  readonly v3: string;
  /** What v4 did, in one short phrase. */
  readonly v4: string;
  /** Why they differ: the report reasons, or the missing counterpart. */
  readonly reason: string;
  /** The conversion report items that explain it (`cause: reported`). */
  readonly items: readonly string[];
}
