/** Result types of the binary operators of the rule language (docs/06). `bad` reports a misuse and returns `dyn`. */
import type { ExprErrorCode } from '../../registry/expr-errors';
import { T, assignable, comparable, isDyn, isNumeric, orderable, unify } from './ty';
import type { Ty } from './types';

export type Bad = (code: ExprErrorCode, why: string) => Ty;

const ARITH_NUMERIC = new Set(['+', '-', '*', '/', '%']);

export function binaryType(op: string, l: Ty, r: Ty, bad: Bad): Ty {
  if (op === '&&' || op === '||') {
    if (!assignable(l, T.bool) || !assignable(r, T.bool)) return bad('op_needs_bool', 'needs bool operands');
    return T.bool;
  }
  if (op === '==' || op === '!=')
    return comparable(l, r) ? T.bool : bad('op_compares_different', 'compares different types');
  if (op === '<' || op === '<=' || op === '>' || op === '>=')
    return orderable(l, r) ? T.bool : bad('op_cannot_order', 'cannot order these types');
  if (op === 'in') {
    if (isDyn(r)) return T.bool;
    if (r.kind === 'list' && comparable(l, r.element)) return T.bool;
    if (r.kind === 'map' && comparable(l, r.key)) return T.bool;
    return bad('op_in_mismatch', 'needs an element and a list or map that fit together');
  }
  if (!ARITH_NUMERIC.has(op)) return bad('op_unsupported', 'is not supported');
  return arithmetic(op, l, r, bad);
}

function arithmetic(op: string, l: Ty, r: Ty, bad: Bad): Ty {
  if (isDyn(l) || isDyn(r)) return isNumeric(l) ? l : isNumeric(r) ? r : T.dyn;
  if (isNumeric(l) && isNumeric(r)) {
    if (op === '%' && (l.kind !== 'int' || r.kind !== 'int'))
      return bad('op_needs_int', 'needs int operands');
    return l.kind === 'int' && r.kind === 'int' ? T.int : T.double;
  }
  if (op === '+') {
    if (l.kind === 'string' && r.kind === 'string') return T.string;
    if (l.kind === 'list' && r.kind === 'list')
      return unify(l, r) ?? bad('op_lists_differ', 'needs lists of the same element type');
    if (l.kind === 'timestamp' && r.kind === 'duration') return T.timestamp;
    if (l.kind === 'duration' && (r.kind === 'timestamp' || r.kind === 'duration')) return r;
  }
  if (op === '-') {
    if (l.kind === 'timestamp' && r.kind === 'timestamp') return T.duration;
    if (l.kind === 'timestamp' && r.kind === 'duration') return T.timestamp;
    if (l.kind === 'duration' && r.kind === 'duration') return T.duration;
  }
  return bad('op_not_applicable', 'does not apply to these types');
}
