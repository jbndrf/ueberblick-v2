/**
 * `evaluate(typedAst, ctx)` (docs/06-rule-language.md): total and deterministic. No clock and no random
 * source: `now` and `today()` read only `ctx.now`. An error becomes an error result, never a throw, and
 * the work is bounded, so an untrusted AST cannot hang or crash the caller (H4).
 */
import type { TypedAst } from '../check/check';
import type { EvalContext, EvalError, EvalResult, EvalValue, EvaluateApi } from '../contract';
import { EvalFault } from '../functions/support';
import { compiled } from './compile';
import { MAX_ITERATIONS, NO_SLOTS, type Run } from './run';
import { valueKind } from './ops';

export { MAX_ITERATIONS } from './run';

function toError(e: unknown, typed: TypedAst): EvalError {
  if (e instanceof EvalFault) return { message: e.message, span: e.span ?? typed.ast.span };
  if (e instanceof RangeError) return { message: 'expression is nested too deeply', span: typed.ast.span };
  return { message: 'internal error while evaluating', span: typed.ast.span };
}

/** Runs the compiled closure; throws what evaluation throws. */
function run(typed: TypedAst, ctx: EvalContext): EvalValue {
  const c = compiled(typed);
  const r: Run = { ctx, slots: c.slots === 0 ? NO_SLOTS : [], budget: MAX_ITERATIONS, safe: false };
  return c.fn(r);
}

export function evaluate(typed: TypedAst, ctx: EvalContext): EvalResult {
  try {
    return { ok: true, value: run(typed, ctx) };
  } catch (e) {
    return { ok: false, error: toError(e, typed) };
  }
}

const TRUE = { value: true } as const;
const FALSE = { value: false } as const;

/** The two answers without an error are shared, so the hot path allocates no result object. */
export function condition(
  typed: TypedAst,
  ctx: EvalContext,
): { readonly value: boolean; readonly error?: EvalError } {
  let v: EvalValue;
  try {
    v = run(typed, ctx);
  } catch (e) {
    return { value: false, error: toError(e, typed) };
  }
  if (v === true) return TRUE;
  // null is a missing value: the condition does not hold, and that is not worth reporting
  if (v === false || v === null) return FALSE;
  return {
    value: false,
    error: {
      message: `a condition must be true or false but is ${valueKind(v)}`,
      span: typed.ast.span,
    },
  };
}

export const evaluateApi: EvaluateApi = { evaluate, condition };
