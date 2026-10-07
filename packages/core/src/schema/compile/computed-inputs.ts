/**
 * What a `computed` expression reads (WP-312), found by walking its AST. Compile uses it to report the reads plan cannot
 * watch (`computed_input_unsupported`) and cycles (`computed_cycle`); plan uses the same walk to learn which changed
 * properties make a computed property stale (`plan/computed.ts`). It imports no Zod and no checker, so the participant
 * shell may load it (like `indexes.ts`).
 */
import type { Expr } from '../../expr/ast';
import { children } from '../../expr/parse/walk';

export interface ComputedReads {
  /** `self.<field>` reads: the properties, relations and system fields (`$lifecycle`) the expression looks at. */
  readonly fields: ReadonlySet<string>;
  /** Fields read through, as in `self.<field>.<other>`: another feature's value, which plan does not watch. */
  readonly dereferenced: ReadonlySet<string>;
  /** `self` used as a whole (passed to a function, compared), so its fields cannot be listed. */
  readonly bareSelf: boolean;
  /** Any other name that is neither `self` nor `inputs` nor a macro variable: `actor`, `now`. */
  readonly names: ReadonlySet<string>;
  /** `today()` is called. */
  readonly usesTime: boolean;
}

/** Names an expression may read without making the value depend on who runs it or when. */
const STABLE_NAMES = new Set(['self', 'inputs']);

export function computedReads(ast: Expr): ComputedReads {
  const fields = new Set<string>();
  const dereferenced = new Set<string>();
  const names = new Set<string>();
  let bareSelf = false;
  let usesTime = false;
  const isSelf = (e: Expr): boolean => e.kind === 'ident' && e.name === 'self';
  const bound: string[] = [];
  const visit = (e: Expr, parent: Expr | undefined): void => {
    if (e.kind === 'member') {
      if (isSelf(e.object)) fields.add(e.field);
      else if (e.object.kind === 'member' && isSelf(e.object.object)) dereferenced.add(e.object.field);
    } else if (e.kind === 'ident') {
      if (e.name === 'self') {
        if (parent?.kind !== 'member') bareSelf = true;
      } else if (!STABLE_NAMES.has(e.name) && !bound.includes(e.name)) names.add(e.name);
    } else if (e.kind === 'call' && e.name === 'today') usesTime = true;
    if (e.kind === 'comprehension') {
      visit(e.range, e);
      bound.push(e.variable);
      visit(e.body, e);
      bound.pop();
      return;
    }
    for (const c of children(e)) visit(c, e);
  };
  visit(ast, undefined);
  return { fields, dereferenced, bareSelf, names, usesTime };
}

/**
 * The computed properties of one type in an order that computes every property after the ones it reads (declaration order
 * among the independent ones). `cyclic` lists the properties no order can place: they read each other or themselves.
 * `inputs` maps each computed property to the `self` fields it reads.
 */
export function orderComputed(inputs: ReadonlyMap<string, ReadonlySet<string>>): {
  readonly order: readonly string[];
  readonly cyclic: readonly string[];
} {
  const order: string[] = [];
  const placed = new Set<string>();
  const pending = [...inputs.keys()];
  for (let progress = true; progress && pending.length > 0;) {
    progress = false;
    for (let i = 0; i < pending.length; i++) {
      const key = pending[i] as string;
      const waits = [...(inputs.get(key) ?? [])].some((f) => inputs.has(f) && !placed.has(f));
      if (waits) continue;
      placed.add(key);
      order.push(key);
      pending.splice(i, 1);
      progress = true;
      break;
    }
  }
  return { order, cyclic: pending };
}
