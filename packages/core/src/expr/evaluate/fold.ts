/**
 * Constant folding (WP-670). A subexpression whose operands are literals, `now` and the pure time functions
 * is the same for every feature of a pass, so it is computed once and remembered: `date('2026-01-01')` and
 * `days(7)` for good, `now - days(7)` and `today()` while `ctx.now` is unchanged. Only a successful value is
 * remembered; a fault is raised again on every evaluation, exactly as an unfolded expression would.
 */
import type { Expr } from '../ast';
import type { EvalValue } from '../contract';
import type { Fn } from './run';

/** The functions that read nothing but their arguments. */
const PURE_CALLS: ReadonlySet<string> = new Set([
  'date',
  'days',
  'hours',
  'minutes',
  'months',
  'days_between',
]);

const MAX_FOLD_DEPTH = 32;

type Constness = 'pure' | 'now';

const join = (a: Constness | undefined, b: Constness | undefined): Constness | undefined =>
  a === undefined || b === undefined ? undefined : a === 'now' || b === 'now' ? 'now' : 'pure';

/** `pure`: the same in every evaluation; `now`: a function of `ctx.now` only; undefined: reads a feature or variable. */
export function constness(e: Expr, shadowed: (name: string) => boolean, depth = 0): Constness | undefined {
  // A constant is a short expression; a 16k-term chain is not walked (and not folded).
  if (depth > MAX_FOLD_DEPTH) return undefined;
  const sub = (x: Expr) => constness(x, shadowed, depth + 1);
  switch (e.kind) {
    case 'literal':
      return 'pure';
    case 'ident':
      return e.name === 'now' && !shadowed('now') ? 'now' : undefined;
    case 'unary':
      return sub(e.operand);
    case 'binary':
      return join(sub(e.left), sub(e.right));
    case 'call': {
      if (e.target) return undefined;
      let c: Constness | undefined = e.name === 'today' ? 'now' : PURE_CALLS.has(e.name) ? 'pure' : undefined;
      for (const a of e.args) c = join(c, sub(a));
      return c;
    }
    default:
      return undefined;
  }
}

/** `f` computed once (`pure`), or once per distinct `ctx.now` (`now`). */
export function remember(f: Fn, kind: Constness): Fn {
  let known = false;
  let at: string | undefined;
  let value: EvalValue = null;
  if (kind === 'pure')
    return (r) => {
      if (known) return value;
      value = f(r);
      known = true;
      return value;
    };
  return (r) => {
    const now = r.ctx.now;
    if (known && now === at) return value;
    value = f(r);
    at = now;
    known = true;
    return value;
  };
}
