/**
 * Time functions. Timestamps are ISO 8601 strings, durations are milliseconds. `today()` and `now` read
 * only the injected `EvalContext.now`. `months(n)` is a calendar duration: `{ $months, $ms }`, see evaluate/duration.ts.
 */
import { T } from '../check/ty';
import { cat, raw, unsupported } from '../sql/frag';
import { defineFunction, type SqlCall } from './define';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, fail, toInstant, toMs } from './support';

const num = (v: unknown): number => (typeof v === 'number' ? v : fail('needs a number'));

export const today = defineFunction({
  name: 'today',
  sigs: [{ params: [], returns: T.timestamp }],
  evaluate: (_call, { ctx }) => toInstant(Math.floor(toMs(ctx.now) / MS_PER_DAY) * MS_PER_DAY),
});

const first = (call: SqlCall) => (call.args[0] as SqlCall['args'][number]).frag;

/** The canonical timestamp text (ISO 8601, milliseconds, Z): what `date()` returns and what is stored. */
const ISO = "'%Y-%m-%dT%H:%M:%fZ'";

export const days = defineFunction({
  name: 'days',
  sigs: [{ params: [T.int], returns: T.duration }],
  sql: (call) => cat('(', first(call), ` * ${MS_PER_DAY})`),
  evaluate: ({ args }) => num(args[0]) * MS_PER_DAY,
});

/** An exact duration of `n` units: `hours(n)` and `minutes(n)` differ only in the unit. */
const exactDuration = (name: string, unitMs: number) =>
  defineFunction({
    name,
    sigs: [{ params: [T.int], returns: T.duration }],
    sql: (call) => cat('(', first(call), ` * ${unitMs})`),
    evaluate: ({ args }) => num(args[0]) * unitMs,
  });

export const hours = exactDuration('hours', MS_PER_HOUR);
export const minutes = exactDuration('minutes', MS_PER_MINUTE);

export const months = defineFunction({
  name: 'months',
  sigs: [{ params: [T.int], returns: T.duration }],
  // Calendar months clamp to the end of the month (Jan 31 + 1 month = Feb 28), which SQLite's date modifiers
  // do not (they overflow into March). `ts +/- months(n)` is written by the translator as ub_add_months.
  sql: () => unsupported('months() other than as the right side of + or - on a timestamp'),
  evaluate: ({ args }) => ({ $months: num(args[0]), $ms: 0 }),
});

export const date = defineFunction({
  name: 'date',
  sigs: [{ params: [T.string], returns: T.timestamp }],
  sql: (call) => cat('strftime(', raw(ISO), ', ', first(call), ')'),
  evaluate: ({ args }) => toInstant(toMs(args[0] as string)),
});

export const daysBetween = defineFunction({
  name: 'days_between',
  sigs: [{ params: [T.timestamp, T.timestamp], returns: T.int }],
  sql: (call) => {
    const b = (call.args[1] as SqlCall['args'][number]).frag;
    return cat(
      'CAST((unixepoch(',
      b,
      ", 'subsec') - unixepoch(",
      first(call),
      ", 'subsec')) / 86400.0 AS INTEGER)",
    );
  },
  evaluate: ({ args }) => Math.trunc((toMs(args[1] as string) - toMs(args[0] as string)) / MS_PER_DAY),
});

export const TIME_FUNCTIONS = [today, days, hours, minutes, months, date, daysBetween];
