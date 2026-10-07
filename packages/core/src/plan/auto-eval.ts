/**
 * The evaluation every automatic action makes before its task runs: the entry `when` (C-004). Its values come from the
 * task's `then.set`, never from the entry: an automatic run has no form. The one implementation: event-triggered entries (`fireOne`, rules.ts) and the server's timers
 * (`timers/fire.ts`) both call it, so the two cannot drift (closes the twin of WP-556, R1).
 */
import type { EvalContext } from '../expr/contract';
import { condition } from '../expr/evaluate';
import { explain } from '../expr/explain';
import { autoPath, type Auto } from '../schema/compile/autos';
import type { CompiledConfig } from '../schema/compile/contract';
import { PlanConfigError } from './scope';

type Explained = ReturnType<typeof explain>;
export type AutoWhen = { readonly held: true } | { readonly held: false; readonly explanation: Explained };

/**
 * Does the entry `when` hold? An edge entry (no timing) has already been judged by the planner on the features a run
 * touched, so its `when` is not asked again; an entry without `when` always holds.
 */
export function autoWhen(config: CompiledConfig, auto: Auto, ctx: EvalContext): AutoWhen {
  if (auto.entry.when === undefined || auto.kind === 'edge') return { held: true };
  const path = autoPath(auto, 'when');
  const typed = config.expressions.get(path)?.typed;
  if (typed === undefined) throw new PlanConfigError(path);
  return condition(typed, ctx).value ? { held: true } : { held: false, explanation: explain(typed, ctx) };
}
