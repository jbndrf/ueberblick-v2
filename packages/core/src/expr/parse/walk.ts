import type { Expr } from '../ast';

/** Direct children of a node, in source order. */
export function children(e: Expr): readonly Expr[] {
  switch (e.kind) {
    case 'literal':
    case 'ident':
      return [];
    case 'member':
      return [e.object];
    case 'index':
      return [e.object, e.index];
    case 'call':
      return e.target ? [e.target, ...e.args] : e.args;
    case 'has':
      return [e.select];
    case 'comprehension':
      return [e.range, e.body];
    case 'unary':
      return [e.operand];
    case 'binary':
      return [e.left, e.right];
    case 'conditional':
      return [e.test, e.then, e.else];
    case 'list':
      return e.elements;
    case 'map':
      return e.entries.flatMap((en) => [en.key, en.value]);
  }
}

/** The deepest node and its depth, computed iteratively (safe for very deep trees). */
export function deepest(root: Expr): { readonly node: Expr; readonly depth: number } {
  const stack: { node: Expr; depth: number }[] = [{ node: root, depth: 1 }];
  let best = stack[0] as { node: Expr; depth: number };
  while (stack.length > 0) {
    const cur = stack.pop() as { node: Expr; depth: number };
    if (cur.depth > best.depth) best = cur;
    for (const c of children(cur.node)) stack.push({ node: c, depth: cur.depth + 1 });
  }
  return best;
}
