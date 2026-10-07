/**
 * "Idle enough" of a sweep (`on: { schedule, idle }`, owner A10 b; v3 `reference/pb/pb_hooks` sweep, lines 140-195,
 * `if_inactive_days`): an Objekt qualifies when its last change plus `idle` is at or before the sweep's time.
 * One definition for the server sweep and the builder simulator (R1). Pure: time arrives as instants (R2).
 */
import type { EvalContext } from '../../expr';
import { evaluate } from '../../expr/evaluate';
import { shift, toDur, type Dur } from '../../expr/evaluate/duration';
import type { Instant } from '../../model';
import type { ScheduleRule } from './elapsed';

function idleOf(rule: ScheduleRule, ctx: EvalContext): Dur | undefined {
  if (rule.idle === undefined) return undefined;
  const r = evaluate(rule.idle.typed, ctx);
  return r.ok ? toDur(r.value) : undefined;
}

/**
 * True when `changedAt + idle <= ctx.now`. `ctx.vars` holds `self` (the Objekt) for an `idle` that reads it.
 * A rule without `idle` is always idle enough. No last change, or an `idle` that does not evaluate to a duration
 * (evaluation is total), is not idle enough: the sweep never fires on a guess.
 */
export function idleEnough(rule: ScheduleRule, changedAt: Instant | undefined, ctx: EvalContext): boolean {
  if (rule.idle === undefined) return true;
  const idle = idleOf(rule, ctx);
  if (idle === undefined || changedAt === undefined) return false;
  try {
    return Date.parse(shift(changedAt, idle)) <= Date.parse(ctx.now);
  } catch {
    return false;
  }
}

/**
 * A database prefilter for a sweep: Objekte changed after this instant (ms) are never idle enough. Only for an
 * `idle` that is a constant exact duration (no calendar months, no `self`); otherwise undefined and the sweep
 * checks `idleEnough` per Objekt. The prefilter only narrows the candidates, so `idleEnough` stays the decision.
 */
export function idleCutoffMs(rule: ScheduleRule, ctx: EvalContext): number | undefined {
  const vars = new Map([...ctx.vars].filter(([k]) => k !== 'self'));
  const idle = idleOf(rule, { ...ctx, vars });
  return idle === undefined || idle.months !== 0 ? undefined : Date.parse(ctx.now) - idle.ms;
}
