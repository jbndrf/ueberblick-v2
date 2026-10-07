/** Which `form.<field>` an expression reads, from its AST (no evaluation). */
import type { Expr } from '../expr/ast';

/** The fields read by name; `all` when `form` is used as a whole or indexed dynamically. */
export interface FormReads {
  readonly fields: ReadonlySet<string>;
  readonly all: boolean;
  /** True when an expression reads `now`: its value differs between the device and the server. */
  readonly now: boolean;
}

const isForm = (e: Expr): boolean => e.kind === 'ident' && e.name === 'form';

export function formReads(roots: readonly Expr[]): FormReads {
  const fields = new Set<string>();
  let all = false;
  let now = false;
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case 'ident':
        if (e.name === 'form') all = true;
        if (e.name === 'now') now = true;
        return;
      case 'literal':
        return;
      case 'member':
        if (isForm(e.object)) fields.add(e.field);
        else walk(e.object);
        return;
      case 'has':
        walk(e.select);
        return;
      case 'index':
        if (isForm(e.object) && e.index.kind === 'literal' && typeof e.index.value === 'string')
          fields.add(e.index.value);
        else {
          walk(e.object);
          walk(e.index);
        }
        return;
      case 'call':
        if (e.target) walk(e.target);
        e.args.forEach(walk);
        return;
      case 'comprehension':
        walk(e.range);
        walk(e.body);
        return;
      case 'unary':
        walk(e.operand);
        return;
      case 'binary':
        walk(e.left);
        walk(e.right);
        return;
      case 'conditional':
        walk(e.test);
        walk(e.then);
        walk(e.else);
        return;
      case 'list':
        e.elements.forEach(walk);
        return;
      case 'map':
        for (const m of e.entries) {
          walk(m.key);
          walk(m.value);
        }
        return;
    }
  };
  roots.forEach(walk);
  return { fields, all, now };
}
