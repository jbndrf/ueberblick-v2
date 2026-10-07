/**
 * A rule's `when` as the Auslöser picker and the Bedingung rows share it: a conjunction of leaves, some
 * written by the picker (a stage pin, `previous('stage') == 'a'`, `changed('p')`), the rest the admin's
 * rows. Pure text in, text out; core's parser says what a leaf is (R5). The conjunct split and join are the
 * task pane's (`task/when.ts`, R1).
 */
import type { Expr } from '@ueberblick/core/expr/compile';
import { bin as binary } from '../task/when';

const stringOf = (e: Expr): string | undefined =>
  e.kind === 'literal' && typeof e.value === 'string' ? e.value : undefined;

const isSelf = (e: Expr, property: string): boolean =>
  e.kind === 'member' && e.field === property && e.object.kind === 'ident' && e.object.name === 'self';

/** `self.<property> == 'x'`: the option x. */
export function selfEquals(ast: Expr, property: string): string | undefined {
  const eq = binary(ast, '==');
  return eq !== undefined && isSelf(eq.left, property) ? stringOf(eq.right) : undefined;
}

/** `previous('<property>') == 'x'`: the option x. */
export function previousEquals(ast: Expr, property: string): string | undefined {
  const eq = binary(ast, '==');
  if (eq === undefined || eq.left.kind !== 'call') return undefined;
  const call = eq.left;
  const arg = call.args[0];
  return call.name === 'previous' && call.args.length === 1 && arg !== undefined && stringOf(arg) === property
    ? stringOf(eq.right)
    : undefined;
}

/** `changed('a') || changed('b')`: the properties; undefined when the leaf is anything else. */
export function changedList(ast: Expr): string[] | undefined {
  const out: string[] = [];
  const stack: Expr[] = [ast];
  while (stack.length > 0) {
    const e = stack.pop() as Expr;
    const or = binary(e, '||');
    if (or !== undefined) {
      stack.push(or.right, or.left);
    } else if (e.kind === 'call' && e.name === 'changed' && e.args.length === 1) {
      const p = stringOf(e.args[0] as Expr);
      if (p === undefined) return undefined;
      out.push(p);
    } else return undefined;
  }
  return out;
}
