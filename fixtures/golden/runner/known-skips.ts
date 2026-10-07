/**
 * Named, explicit skips: the corpus and core (or a template) disagree, and the disagreement is tracked
 * outside this work package. The runner reports every skip with its issue, and `scenarios.spec.ts` fails
 * when an entry no longer matches anything ("stale"), so this list can only shrink and never hides a step
 * silently. An entry matches either a step refusal message (`refusal`) or exact places (`at`, as
 * `<scenario>/<step id>`, or `<scenario>/then` for the final-state assertions).
 *
 * Every issue names the work package that fixes it (the corpus is the spec): `WP-011.2` (template write
 * permissions), `WP-041.3` (core.plan defects found by the runner).
 */
export interface KnownSkip {
  /** The work package or divergence label that resolves it. */
  readonly issue: string;
  readonly reason: string;
  /** Matches the refusal message of a step whose result differs from the scenario. */
  readonly refusal?: RegExp;
  readonly at?: readonly string[];
}

export const hitKey = (k: KnownSkip, at?: string): string => (at === undefined ? k.issue : `${k.issue}@${at}`);

export const KNOWN_SKIPS: readonly KnownSkip[] = [];
