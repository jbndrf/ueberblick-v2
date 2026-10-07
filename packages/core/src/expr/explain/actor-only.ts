/**
 * Does a sub-expression depend on the person (`actor.roles`, `actor.kind`, `actor.id`) and on nothing else of the world
 * (WP-787)? True when it reads `actor` and every free name in it is `actor`, `inputs` or `now` (a comprehension
 * variable is bound, not free).
 * Walks the AST with a stack: no recursion, so a long operand cannot overflow it.
 */
import type { Expr } from '../ast';

const PERSON = new Set(['actor', 'inputs', 'now']);

function children(e: Expr): readonly Expr[] {
  switch (e.kind) {
    case 'literal':
    case 'ident':
      return [];
    case 'member':
      return [e.object];
    case 'index':
      return [e.object, e.index];
    case 'call':
      return e.target === undefined ? e.args : [e.target, ...e.args];
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
      return e.entries.flatMap((m) => [m.key, m.value]);
  }
}

type Scoped = readonly [Expr, readonly string[]];

export function readsOnlyActor(root: Expr): boolean {
  let actor = false;
  const stack: Scoped[] = [[root, []]];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const [e, bound] = top;
    if (e.kind === 'ident') {
      if (e.name === 'actor' && !bound.includes('actor')) actor = true;
      else if (!PERSON.has(e.name) && !bound.includes(e.name)) return false;
    }
    if (e.kind === 'comprehension') {
      // the variable is bound in the body only; the range sees the outer names
      stack.push([e.range, bound], [e.body, [...bound, e.variable]]);
    } else for (const c of children(e)) stack.push([c, bound]);
  }
  return actor;
}
