/**
 * Builder chips: a flat, editable view of simple conditions (`self.stage == 'aktiv' && self.hoehe > 10`).
 * `toChips` succeeds only when `fromChips(chips)` gives back exactly the same AST, so a chip list never
 * changes what an expression means; anything else (parentheses, calls, right-nested groups) comes back as
 * text. Flat chains of any length are handled with loops.
 */
import type { Json } from '../../model';
import type { ExprBinaryOperator } from '../../registry';
import type { BinaryNode, Expr } from '../ast';
import { print } from '../explain/print';
import type { Chip, ChipsResult } from '../sql/contract';

const SPAN = { start: 0, end: 0 };
const JOIN_PRECEDENCE: Readonly<Record<string, number>> = { '||': 1, '&&': 2 };
const COMPARISONS = new Set<string>(['==', '!=', '<', '<=', '>', '>=', 'in']);
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** A dotted name such as `self.hoehe`, or undefined. */
function pathOf(e: Expr): string | undefined {
  const names: string[] = [];
  let cur: Expr = e;
  while (cur.kind === 'member') {
    names.push(cur.field);
    cur = cur.object;
  }
  if (cur.kind !== 'ident') return undefined;
  names.push(cur.name);
  const path = names.reverse().join('.');
  return PATH.test(path) ? path : undefined;
}

function literalValue(e: Expr): { readonly v: Json } | undefined {
  if (e.kind === 'literal') return { v: e.value };
  if (e.kind === 'list') {
    const out: Json[] = [];
    for (const el of e.elements) {
      if (el.kind !== 'literal') return undefined;
      out.push(el.value);
    }
    return { v: out };
  }
  return undefined;
}

function compareChip(e: Expr): Chip | undefined {
  if (e.kind !== 'binary' || !COMPARISONS.has(e.op)) return undefined;
  const left = pathOf(e.left);
  const right = literalValue(e.right);
  if (left === undefined || right === undefined) return undefined;
  return { kind: 'compare', left, op: e.op, right: right.v };
}

/** The leaves and joins of a tree of `&&`/`||`, in source order; undefined when a leaf is not a simple comparison. */
function flatten(root: Expr): Chip[] | undefined {
  const chips: Chip[] = [];
  const stack: (Expr | Chip)[] = [root];
  while (stack.length > 0) {
    const x = stack.pop() as Expr | Chip;
    if ('kind' in x && x.kind === 'join') {
      chips.push(x);
    } else if ('span' in x && x.kind === 'binary' && (x.op === '&&' || x.op === '||')) {
      stack.push(x.right, { kind: 'join', op: x.op }, x.left);
    } else if ('span' in x) {
      const c = compareChip(x);
      if (c === undefined) return undefined;
      chips.push(c);
    }
  }
  return chips;
}

const lit = (v: Json): Expr => {
  if (Array.isArray(v)) return { kind: 'list', elements: v.map(lit), span: SPAN };
  if (v === null) return { kind: 'literal', type: 'null', value: null, span: SPAN };
  if (typeof v === 'boolean') return { kind: 'literal', type: 'bool', value: v, span: SPAN };
  if (typeof v === 'string') return { kind: 'literal', type: 'string', value: v, span: SPAN };
  if (typeof v === 'number')
    return { kind: 'literal', type: Number.isInteger(v) ? 'int' : 'double', value: v, span: SPAN };
  // a map is not a chip value; keep the total function honest with an empty map literal
  return { kind: 'map', entries: [], span: SPAN };
};

function pathExpr(path: string): Expr {
  const [head, ...rest] = path.split('.') as [string, ...string[]];
  let e: Expr = { kind: 'ident', name: head, span: SPAN };
  for (const field of rest) e = { kind: 'member', object: e, field, span: SPAN };
  return e;
}

const binary = (op: ExprBinaryOperator, left: Expr, right: Expr): BinaryNode => ({
  kind: 'binary',
  op,
  left,
  right,
  span: SPAN,
});

/** Chips → AST with the precedence of the language (`&&` binds tighter than `||`), joins left-associative. */
export function fromChips(chips: readonly Chip[]): Expr {
  const out: Expr[] = [];
  const ops: ExprBinaryOperator[] = [];
  const reduce = () => {
    const op = ops.pop() as ExprBinaryOperator;
    const right = out.pop();
    const left = out.pop();
    if (left !== undefined && right !== undefined) out.push(binary(op, left, right));
    else if (right !== undefined) out.push(right);
  };
  for (const c of chips) {
    if (c.kind === 'compare') {
      out.push(binary(c.op, pathExpr(c.left), lit(c.right)));
      continue;
    }
    while (
      ops.length > 0 &&
      (JOIN_PRECEDENCE[ops[ops.length - 1] as string] ?? 0) >= (JOIN_PRECEDENCE[c.op] ?? 0)
    )
      reduce();
    ops.push(c.op);
  }
  while (ops.length > 0) reduce();
  return out[0] ?? { kind: 'literal', type: 'bool', value: true, span: SPAN };
}

/** Structural equality ignoring spans; iterative. */
function same(a: Expr, b: Expr): boolean {
  const stack: [Expr, Expr][] = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [Expr, Expr];
    if (x.kind !== y.kind) return false;
    switch (x.kind) {
      case 'literal':
        if (x.type !== (y as typeof x).type || x.value !== (y as typeof x).value) return false;
        break;
      case 'ident':
        if (x.name !== (y as typeof x).name) return false;
        break;
      case 'member':
        if (x.field !== (y as typeof x).field) return false;
        stack.push([x.object, (y as typeof x).object]);
        break;
      case 'binary':
        if (x.op !== (y as typeof x).op) return false;
        stack.push([x.left, (y as typeof x).left], [x.right, (y as typeof x).right]);
        break;
      case 'list': {
        const ys = (y as typeof x).elements;
        if (x.elements.length !== ys.length) return false;
        x.elements.forEach((el, i) => stack.push([el, ys[i] as Expr]));
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

export function toChips(ast: Expr): ChipsResult {
  const chips = flatten(ast);
  if (chips !== undefined && same(fromChips(chips), ast)) return { ok: true, chips };
  return { ok: false, text: print(ast) };
}
