/** Overload resolution of function calls (docs/06). Reports an unknown function or a call that matches no signature. */
import type { CallNode } from '../ast';
import type { Checker } from './check';
import { BUILTIN_FUNCTIONS, HISTORY_FUNCTIONS } from './functions';
import { assignable, closest, own, show } from './ty';
import type { Ty } from './types';

/** The type a call yields; `target` is the receiver type of a receiver-style call. */
export function checkCall(h: Checker, e: CallNode, target: Ty | undefined, args: readonly Ty[]): Ty {
  const sigs = own(h.env.functions, e.name) ?? own(BUILTIN_FUNCTIONS, e.name);
  if (!sigs) {
    const near = closest(e.name, [
      ...Object.keys(BUILTIN_FUNCTIONS),
      ...Object.keys(h.env.functions ?? {}),
      ...HISTORY_FUNCTIONS,
    ]);
    return h.err(
      'unknown_function',
      `unknown function '${e.name}'`,
      e.span,
      near ? { name: e.name, near } : { name: e.name },
      near ? [`did you mean '${near}'?`, 'default'] : undefined,
    );
  }
  const arity = sigs.filter(
    (s) => (s.target !== undefined) === (target !== undefined) && s.params.length === args.length,
  );
  const match = arity.find(
    (s) =>
      (target === undefined || (s.target !== undefined && assignable(target, s.target))) &&
      s.params.every((p, i) => assignable(args[i] as Ty, p)),
  );
  if (match) return match.returns;
  const shown = `${target ? `${show(target)}.` : ''}${e.name}(${args.map(show).join(', ')})`;
  const wanted = sigs
    .map((s) => `${s.target ? `${show(s.target)}.` : ''}${e.name}(${s.params.map(show).join(', ')})`)
    .join(' or ');
  return h.err(
    'no_signature',
    `${shown} does not match any signature`,
    e.span,
    { call: shown, expected: wanted },
    [`expected ${wanted}`, 'default'],
  );
}
