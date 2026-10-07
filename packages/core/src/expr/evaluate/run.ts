/** State of one `evaluate` call and the compiled closure type. */
import type { EvalContext, EvalValue } from '../contract';

export interface Run {
  readonly ctx: EvalContext;
  /** Comprehension variables by slot. */
  readonly slots: EvalValue[];
  /** Iterations left; bounds the work an untrusted expression can do. */
  budget: number;
  /**
   * Set once a chain's fast path met a fault. From then on every chain runs its general path directly, so
   * a faulting expression is evaluated at most twice per level, never exponentially often.
   */
  safe: boolean;
}

export type Fn = (r: Run) => EvalValue;

/** Shared by expressions without comprehensions; never written to. */
export const NO_SLOTS: EvalValue[] = [];

export const MAX_ITERATIONS = 100_000;
