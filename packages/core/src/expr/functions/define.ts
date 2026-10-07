/**
 * The one function registry (R1). A function is defined once: its type signatures (used by `check`), its
 * evaluation, and its SQL encoding where SQLite can express it. `check/functions.ts` derives from this registry.
 */
import type { Json } from '../../model';
import type { FunctionSig, Ty } from '../check/types';
import type { EvalContext, EvalValue } from '../contract';
import type { Frag } from '../sql/frag';

/** The arguments of one call. `target` is set for receiver style (`s.startsWith(t)`). */
export interface FunctionCall {
  readonly target: EvalValue | undefined;
  readonly args: readonly EvalValue[];
}

export interface FunctionEnv {
  readonly ctx: EvalContext;
}

/** One argument of a call being translated to SQL. `literal` is set when the argument is a constant. */
export interface SqlArg {
  readonly frag: Frag;
  readonly ty: Ty;
  readonly literal: Json | undefined;
}

/** A call being translated to SQL; the receiver, if any, is the first argument. */
export interface SqlCall {
  readonly args: readonly SqlArg[];
  /** Alias of the `features` row of `self` (history functions read `observations` of it). */
  readonly self: string;
}

/** SQL encoding of a call. Throw `unsupported(reason)` (sql/frag) when this overload has none. */
export type FunctionSql = (call: SqlCall) => Frag;

export interface FunctionDef {
  readonly name: string;
  /** Overloads for `check`; empty for functions that `check` handles itself (history). */
  readonly sigs: readonly FunctionSig[];
  /**
   * Report a problem with `fail(message)` (an error result, never a crash). A null target or argument
   * yields null before this is called.
   */
  readonly evaluate: (call: FunctionCall, env: FunctionEnv) => EvalValue;
  /** Absent: the function has no SQL encoding (spatial predicates), and `toSql` reports it as unsupported. */
  readonly sql?: FunctionSql;
}

export function defineFunction(def: FunctionDef): FunctionDef {
  return def;
}
