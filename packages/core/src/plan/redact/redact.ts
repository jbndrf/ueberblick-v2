/**
 * The pure part of erasure (B-005, docs/research/gdpr-erasure.md §5): given the (feature, property) pairs of a
 * subject's personal values, plan the null observations that make the erased state current and the list of pairs the
 * server's run transaction purges in place. No I/O (R2); the caller decides which pairs belong to the subject.
 */
import type { FeatureId, Instant, Observation } from '../../model';
import { redactionKey } from '../../sync/redaction';

export interface RedactPair {
  readonly featureId: FeatureId;
  readonly property: string;
}

export interface RedactionInput {
  readonly pairs: readonly RedactPair[];
  readonly phenomenonTime?: Instant;
}

export interface RedactionPlan {
  /** One `result: null` observation per distinct pair, in pair order (feature id, then property). */
  readonly observations: readonly Observation[];
  /** The pairs whose superseded results (and the run inputs that wrote them) the server overwrites. Only a run transaction may execute it. */
  readonly purge: readonly RedactPair[];
  /** `redaction` tombstone ids (`redactionKey`), aligned with `purge`. */
  readonly tombstones: readonly string[];
}

/** `$type` and `$lifecycle` are reserved (docs/04): erasure blanks personal properties, never the feature itself. */
const isReserved = (property: string): boolean => property.startsWith('$');

export function planRedaction(input: RedactionInput): RedactionPlan {
  const distinct = new Map<string, RedactPair>();
  for (const p of input.pairs) {
    if (isReserved(p.property)) throw new Error(`cannot redact reserved property '${p.property}'`);
    distinct.set(redactionKey(p.featureId, p.property), p);
  }
  const purge = [...distinct.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, p]) => ({ featureId: p.featureId, property: p.property }));
  return {
    observations: purge.map((p) => ({
      featureId: p.featureId,
      property: p.property,
      result: null,
      ...(input.phenomenonTime !== undefined ? { phenomenonTime: input.phenomenonTime } : {}),
    })),
    purge,
    tombstones: purge.map((p) => redactionKey(p.featureId, p.property)),
  };
}
