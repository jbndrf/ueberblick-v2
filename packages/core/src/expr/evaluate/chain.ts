/**
 * Binary operators, compiled and run as a flat chain. The parser allows left-associative chains of about
 * 16k terms (A-005, e.g. long `||` lists), so the left spine is walked with a loop, never by recursion:
 * `((a op b) op c) op d` becomes the first operand plus one step per operator.
 *
 * Errors are values while the chain runs: a fault is kept as the accumulator, so `||` and `&&` can absorb
 * it (`true || error` is true, CEL semantics) and any other step passes it on.
 *
 * Every chain has two paths that give the same result. The fast path (the one nearly every evaluation
 * takes) has no fault values: a fault or a non-bool operand aborts it, and the general path above then
 * evaluates the chain again from its start. Evaluation is pure, so the second run is safe; the iteration
 * budget is restored first. `Run.safe` keeps that retry from repeating on every nesting level.
 */
import type { BinaryNode, Expr, Span } from '../ast';
import type { Ty } from '../check/types';
import type { EvalValue } from '../contract';
import { EvalFault, deepEqual, toMs } from '../functions/support';
import { add, contains, div, mod, mul, order, sameInstant, sub, valueKind } from './ops';
import type { Fn, Run } from './run';

type Acc = EvalValue | EvalFault;

/** The fast path's step: the accumulator is a value, never a fault. Throws to leave the fast path. */
type FastStep = (acc: EvalValue, r: Run) => EvalValue;

/** Thrown by a fast step that meets a non-bool operand; the general path then reports it. Never escapes. */
const LEAVE = new EvalFault('leaves the fast path');

interface Step {
  readonly span: Span;
  /** True for `&&` and `||`, which see a fault instead of passing it on. */
  readonly absorbs: boolean;
  /** Returns the new accumulator; may throw an `EvalFault` (which the loop keeps as the accumulator). */
  readonly apply: (acc: Acc, r: Run) => Acc;
  readonly fast: FastStep;
}

const kindOf = (types: ReadonlyMap<Expr, Ty>, e: Expr): string => types.get(e)?.kind ?? 'dyn';

type Side = boolean | null | EvalFault;

/** Runs an operand and reads it as bool or null; a fault or a non-bool becomes a fault value. */
function side(f: Fn, r: Run, span: Span, what: string): Side {
  try {
    return asSide(f(r), span, what);
  } catch (e) {
    if (e instanceof EvalFault) return e;
    throw e;
  }
}

function asSide(v: Acc, span: Span, what: string): Side {
  if (typeof v === 'boolean' || v === null || v instanceof EvalFault) return v;
  return new EvalFault(`${what} needs a bool but got ${valueKind(v)}`, span);
}

/** Kleene logic with CEL error absorption: `false && x` is false and `true || x` is true, whatever x is. */
function logicStep(right: Fn, span: Span, isOr: boolean): Step {
  const what = `operator '${isOr ? '||' : '&&'}'`;
  return {
    span,
    absorbs: true,
    fast: (acc, r) => {
      if (acc === isOr) return isOr;
      if (acc !== null && acc !== !isOr) throw LEAVE;
      const b = right(r);
      if (b === isOr) return isOr;
      if (b !== null && b !== !isOr) throw LEAVE;
      return acc === null || b === null ? null : !isOr;
    },
    apply: (acc, r) => {
      const a = asSide(acc, span, what);
      if (a === isOr) return isOr;
      const b = side(right, r, span, what);
      if (b === isOr) return isOr;
      if (a instanceof EvalFault) return a;
      if (b instanceof EvalFault) return b;
      return a === null || b === null ? null : !isOr;
    },
  };
}

/** A step that needs both operands and yields null when either is null. */
function strict(right: Fn, span: Span, f: (a: EvalValue, b: EvalValue, r: Run) => EvalValue): Step {
  const fast: FastStep = (a, r) => {
    const b = right(r);
    return a === null || b === null ? null : f(a, b, r);
  };
  return { span, absorbs: false, apply: fast as Step['apply'], fast };
}

/** `<`, `<=`, `>`, `>=`: numbers are compared in place, anything else goes through `order`. */
function compare(right: Fn, span: Span, time: boolean, op: '<' | '<=' | '>' | '>=', constant?: number): Step {
  const pick = (c: number): boolean =>
    op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
  const num = (a: number, b: number): boolean =>
    op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
  if (constant !== undefined) {
    // A number on the right: compare in place, without running an operand.
    const c = constant;
    const other = (a: EvalValue): boolean => pick(order(a, c, time));
    let fast: FastStep;
    switch (op) {
      case '<':
        fast = (a) => (a === null ? null : typeof a === 'number' ? a < c : other(a));
        break;
      case '<=':
        fast = (a) => (a === null ? null : typeof a === 'number' ? a <= c : other(a));
        break;
      case '>':
        fast = (a) => (a === null ? null : typeof a === 'number' ? a > c : other(a));
        break;
      case '>=':
        fast = (a) => (a === null ? null : typeof a === 'number' ? a >= c : other(a));
        break;
    }
    return { span, absorbs: false, apply: fast as Step['apply'], fast };
  }
  // The right operand of a timestamp comparison is usually a folded constant: parse it once, not per feature.
  let text: string | undefined;
  let ms = 0;
  return strict(right, span, (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return num(a, b);
    if (time && typeof a === 'string' && typeof b === 'string') {
      const x = toMs(a);
      if (b !== text) {
        ms = toMs(b);
        text = b;
      }
      return pick(x < ms ? -1 : x > ms ? 1 : 0);
    }
    return pick(order(a, b, time));
  });
}

/** Lists are copied by `+`; charge the copy against the iteration budget. */
function addCharged(a: EvalValue, b: EvalValue, ints: boolean, r: Run): EvalValue {
  if (Array.isArray(a) && (r.budget -= a.length) < 0)
    throw new EvalFault('expression is too expensive to evaluate');
  return add(a, b, ints);
}

function stepOf(n: BinaryNode, right: Fn, types: ReadonlyMap<Expr, Ty>): Step {
  const { span } = n;
  const lk = kindOf(types, n.left);
  const rk = kindOf(types, n.right);
  const time = lk === 'timestamp' || rk === 'timestamp';
  const ints = lk === 'int' && rk === 'int';
  const equal = (a: EvalValue, b: EvalValue) =>
    a === b ||
    (typeof a === 'object' && typeof b === 'object' && deepEqual(a, b)) ||
    (time && typeof a === 'string' && typeof b === 'string' && sameInstant(a, b));
  const lit = n.right.kind === 'literal' ? n.right : undefined;
  const eq = (negated: boolean): Step => {
    let fast: FastStep;
    if (lit && !time) {
      // A primitive constant equals a value exactly when they are identical.
      const v = lit.value;
      fast = negated ? (a) => a !== v : (a) => a === v;
    } else fast = (a, r) => equal(a, right(r)) !== negated;
    return { span, absorbs: false, apply: fast as Step['apply'], fast };
  };
  switch (n.op) {
    case '&&':
      return logicStep(right, span, false);
    case '||':
      return logicStep(right, span, true);
    case '==':
      return eq(false);
    case '!=':
      return eq(true);
    case '<':
    case '<=':
    case '>':
    case '>=':
      return compare(right, span, time, n.op, lit && typeof lit.value === 'number' ? lit.value : undefined);
    case '+':
      return strict(right, span, (a, b, r) => addCharged(a, b, ints, r));
    case '-':
      return strict(right, span, (a, b) => sub(a, b, ints));
    case '*':
      return strict(right, span, (a, b) => mul(a, b, ints));
    case '/':
      return strict(right, span, (a, b) => div(a, b, ints));
    case '%':
      return strict(right, span, (a, b) => mod(a, b));
    case 'in': {
      const fast: FastStep = (a, r) => {
        const b = right(r);
        return b === null ? null : contains(a, b, deepEqual);
      };
      return { span, absorbs: false, apply: fast as Step['apply'], fast };
    }
  }
}

/** Compiles the chain that ends in `e`; `compile` compiles the operands (each at depth `d`). */
export function compileChain(
  e: BinaryNode,
  types: ReadonlyMap<Expr, Ty>,
  compile: (e: Expr, depth: number) => Fn,
  d: number,
): Fn {
  const spine: BinaryNode[] = [];
  let leftmost: Expr = e;
  while (leftmost.kind === 'binary') {
    spine.push(leftmost);
    leftmost = leftmost.left;
  }
  spine.reverse();
  const first = compile(leftmost, d);
  const steps = spine.map((n) => stepOf(n, compile(n.right, d), types));
  const fast = steps.map((s) => s.fast);
  const general = (r: Run): EvalValue => {
    let acc: Acc;
    try {
      acc = first(r);
    } catch (x) {
      if (!(x instanceof EvalFault)) throw x;
      acc = x;
    }
    for (const s of steps) {
      if (acc instanceof EvalFault && !s.absorbs) continue;
      try {
        acc = s.apply(acc, r);
      } catch (x) {
        if (!(x instanceof EvalFault)) throw x;
        acc = x.span ? x : new EvalFault(x.message, s.span);
      }
    }
    if (acc instanceof EvalFault) throw acc.span ? acc : new EvalFault(acc.message, e.span);
    return acc;
  };
  const retry = (r: Run, budget: number): EvalValue => {
    r.safe = true;
    r.budget = budget;
    return general(r);
  };
  const [only] = fast;
  if (only && fast.length === 1) {
    // The common chain, one operator: no loop.
    return (r) => {
      if (r.safe) return general(r);
      const budget = r.budget;
      try {
        return only(first(r), r);
      } catch (x) {
        if (!(x instanceof EvalFault)) throw x;
        return retry(r, budget);
      }
    };
  }
  return (r) => {
    if (r.safe) return general(r);
    const budget = r.budget;
    try {
      let acc = first(r);
      for (let i = 0; i < fast.length; i++) acc = (fast[i] as FastStep)(acc, r);
      return acc;
    } catch (x) {
      if (!(x instanceof EvalFault)) throw x;
      return retry(r, budget);
    }
  };
}
