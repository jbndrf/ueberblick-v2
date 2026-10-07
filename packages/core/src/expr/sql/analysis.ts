/** What `toSql` needs to know about a tree before writing SQL: which nodes read a row, which can fail. */
import type { Json } from '../../model';
import type { Expr } from '../ast';
import { HISTORY_FUNCTIONS } from '../functions';
import { T } from '../check/ty';
import type { Ty } from '../check/types';
import { children } from '../parse/walk';

const nonzeroLiteral = (e: Expr): boolean =>
  e.kind === 'literal' && typeof e.value === 'number' && e.value !== 0;

export interface Analysis {
  /** Nodes whose value depends on a row (or on something that cannot be folded). */
  readonly dep: Set<Expr>;
  /**
   * Nodes that can fail where the rule language reports an error but SQL gives null (a division by a value
   * that may be zero, arithmetic on untyped JSON). Null flows through most operators like an error does
   * (neither holds), but `==`, `!=` and `in` turn null into a plain true or false, so they refuse such operands.
   */
  readonly fails: Set<Expr>;
}

/** One iterative pass over the tree (children before parents). */
export function analyse(root: Expr, vars: ReadonlyMap<string, Json>, types: ReadonlyMap<Expr, Ty>): Analysis {
  const order: Expr[] = [];
  const variables = new Set<string>();
  const stack: Expr[] = [root];
  while (stack.length > 0) {
    const n = stack.pop() as Expr;
    order.push(n);
    if (n.kind === 'comprehension') variables.add(n.variable);
    for (const c of children(n)) stack.push(c);
  }
  const dyn = (e: Expr) => (types.get(e) ?? T.dyn).kind === 'dyn';
  const dep = new Set<Expr>();
  const fails = new Set<Expr>();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i] as Expr;
    let d = false;
    let f = false;
    switch (n.kind) {
      case 'ident':
        d = n.name === 'self' || n.name === 'other' || variables.has(n.name) || !vars.has(n.name);
        break;
      case 'call':
        d = HISTORY_FUNCTIONS.includes(n.name) || (n.name === 'today' && !vars.has('now'));
        f =
          (n.name === 'date' && n.args[0]?.kind !== 'literal') ||
          ((n.name === 'lower' || n.name === 'upper') && n.target !== undefined && dyn(n.target)) ||
          (n.name === 'months' && n.args[0] !== undefined && dyn(n.args[0]));
        break;
      case 'binary':
        f =
          ((n.op === '/' || n.op === '%') && !nonzeroLiteral(n.right)) ||
          (n.op !== '==' && n.op !== '!=' && n.op !== 'in' && (dyn(n.left) || dyn(n.right)));
        break;
      case 'unary':
        f = dyn(n.operand);
        break;
      case 'conditional':
        f = dyn(n.test);
        break;
      case 'comprehension':
        f = dyn(n.body);
        break;
      default:
    }
    for (const c of children(n)) {
      if (dep.has(c)) d = true;
      if (fails.has(c)) f = true;
    }
    if (d) dep.add(n);
    if (f) fails.add(n);
  }
  return { dep, fails };
}
