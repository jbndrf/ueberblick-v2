/**
 * The catch-up rule of `schedule` rules, one definition for the server timers and the builder simulator (R1): a
 * schedule whose due slot is at or before `now` fires **once**, for that slot, however many slots it missed, and is
 * next due at the first slot strictly after `now`. Pure (R2): time arrives as ISO instants.
 */
import type { Instant } from '../../model';
import { nextRun, type ScheduleRule } from './elapsed';

/** When a schedule is due next: at an instant, or never (`ok: false`: no slot within `CRON_HORIZON_DAYS`). */
export type NextDue = { readonly ok: true; readonly at: Instant } | { readonly ok: false };

export type CatchUp =
  | { readonly fire: true; readonly dueAt: Instant; readonly next: NextDue }
  | { readonly fire: false; readonly next: NextDue };

/** First slot of `rule` strictly after `from`. */
export function scheduleDueAfter(rule: ScheduleRule, from: Instant): NextDue {
  const at = nextRun(rule, from);
  return at === undefined ? { ok: false } : { ok: true, at };
}

/** What to do with a schedule due at `dueAt` when the clock reads `now`. */
export function scheduleCatchUp(rule: ScheduleRule, dueAt: Instant, now: Instant): CatchUp {
  if (Date.parse(dueAt) > Date.parse(now)) return { fire: false, next: { ok: true, at: dueAt } };
  return { fire: true, dueAt, next: scheduleDueAfter(rule, now) };
}
