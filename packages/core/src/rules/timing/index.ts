/** core/rules/timing: cron parsing, next run, and the elapsed due time of time-based rules. */
export {
  CRON_HORIZON_DAYS,
  cronMatches,
  nextAfter,
  parseCron,
  type Cron,
  type CronError,
  type CronResult,
} from './cron';
export {
  elapsedDueAt,
  nextRun,
  timeRules,
  type ElapsedRule,
  type ScheduleRule,
  type TimeRules,
} from './elapsed';
export { scheduleCatchUp, scheduleDueAfter, type CatchUp, type NextDue } from './catch-up';
export { idleCutoffMs, idleEnough } from './idle';
