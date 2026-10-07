/** Warnings about time rules that will never fire; deploy and plan report them, they never block (R6: codes are a registry). */
import { autoPath, defineRegistry, type CompiledConfig, type Instant, type KeyOf } from '@ueberblick/core';
import { CRON_HORIZON_DAYS, scheduleDueAfter, timeRules } from '@ueberblick/core/rules/timing';

export const TIMER_WARNING_CODES = defineRegistry([
  {
    key: 'schedule_never_runs',
    description: 'A `schedule` rule has no run inside the cron horizon, so the server never fires it.',
  },
] as const);
export type TimerWarningCode = KeyOf<typeof TIMER_WARNING_CODES>;

/** One warning: where, what, and a fix. Same fields as a compile `Problem`, but it does not block. */
export interface TimerWarning {
  readonly path: string;
  readonly code: TimerWarningCode;
  readonly message: string;
  readonly hint: string;
}

/** The `schedule` rules of `config` with no run inside `CRON_HORIZON_DAYS` after `now`. */
export function timerWarnings(config: CompiledConfig, now: Instant): readonly TimerWarning[] {
  const out: TimerWarning[] = [];
  for (const rule of timeRules(config).schedules.values()) {
    if (scheduleDueAfter(rule, now).ok) continue;
    const auto = config.autos.get(rule.key);
    const source = auto?.entry.schedule ?? '';
    out.push({
      path: auto === undefined ? rule.key : autoPath(auto, 'schedule'),
      code: 'schedule_never_runs',
      message: `The schedule "${source}" has no run in the next ${CRON_HORIZON_DAYS} days, so automatic action ${rule.key} never fires.`,
      hint: 'Check the day of month and month (31 February never occurs), or change the schedule.',
    });
  }
  return out;
}
