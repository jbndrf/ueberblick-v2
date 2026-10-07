/**
 * Five-field cron (`minute hour day-of-month month day-of-week`), UTC, for `schedule` rules. Fields take `*`, a
 * number, a range `a-b`, a step after `*` or a range (`n` after a slash), `a/n` and comma lists. Day of week 0 and 7 are
 * Sunday. As in classic cron, when both day of month and day of week are restricted a day matches if either does.
 * Pure: time arrives as an ISO instant argument (R2).
 */
export interface Cron {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly months: ReadonlySet<number>;
  readonly monthDays: ReadonlySet<number>;
  readonly weekDays: ReadonlySet<number>;
  /** The day-of-month field was `*`. */
  readonly anyMonthDay: boolean;
  /** The day-of-week field was `*`. */
  readonly anyWeekDay: boolean;
}

export interface CronError {
  readonly message: string;
  /** Character offset in the expression where the problem starts. */
  readonly position: number;
}

export type CronResult =
  { readonly ok: true; readonly cron: Cron } | { readonly ok: false; readonly error: CronError };

/**
 * How far ahead `nextAfter` looks: 366 * 8 days (29 February needs up to 8 years). It steps by day, not by minute,
 * and picks the time inside a matching day from the sorted hour and minute lists, so the cost is at most
 * 2,929 day checks per call.
 */
export const CRON_HORIZON_DAYS = 366 * 8;

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
] as const;

/** The values of one field, or the reason it is wrong. */
function field(text: string, min: number, max: number): number[] | string {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (m === null) return `'${part}' is not a cron field`;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return `the step in '${part}' must be at least 1`;
    let lo = min;
    let hi = max;
    if (m[1] !== '*') {
      const [a, b] = (m[1] as string).split('-').map(Number) as [number, number | undefined];
      lo = a;
      hi = b ?? (m[2] === undefined ? a : max);
    }
    if (lo < min || hi > max) return `'${part}' is outside ${min}-${max}`;
    if (lo > hi) return `'${part}' is a range that runs backwards`;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

export function parseCron(expr: string): CronResult {
  const parts = [...expr.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index }));
  if (parts.length !== 5) {
    const position = parts.length > 5 ? (parts[5] as { at: number }).at : expr.length;
    return {
      ok: false,
      error: { message: `a cron expression has 5 fields, found ${parts.length}`, position },
    };
  }
  const values: number[][] = [];
  for (const [i, p] of parts.entries()) {
    const spec = FIELDS[i] as (typeof FIELDS)[number];
    const v = field(p.text, spec.min, spec.max);
    if (typeof v === 'string') return { ok: false, error: { message: `${spec.name}: ${v}`, position: p.at } };
    values.push(v);
  }
  const [minutes, hours, monthDays, months, weekDays] = values as [
    number[],
    number[],
    number[],
    number[],
    number[],
  ];
  return {
    ok: true,
    cron: {
      minutes,
      hours,
      months: new Set(months),
      monthDays: new Set(monthDays),
      weekDays: new Set(weekDays.map((d) => d % 7)),
      anyMonthDay: (parts[2] as { text: string }).text === '*',
      anyWeekDay: (parts[4] as { text: string }).text === '*',
    },
  };
}

function dayMatches(c: Cron, d: Date): boolean {
  if (!c.months.has(d.getUTCMonth() + 1)) return false;
  const byMonthDay = c.monthDays.has(d.getUTCDate());
  const byWeekDay = c.weekDays.has(d.getUTCDay());
  if (c.anyMonthDay && c.anyWeekDay) return true;
  if (c.anyMonthDay) return byWeekDay;
  if (c.anyWeekDay) return byMonthDay;
  return byMonthDay || byWeekDay;
}

/** True when the minute containing `at` (ISO instant) matches `c`. */
export function cronMatches(c: Cron, at: string): boolean {
  const d = new Date(at);
  return dayMatches(c, d) && c.hours.includes(d.getUTCHours()) && c.minutes.includes(d.getUTCMinutes());
}

/** The first matching minute strictly after `from` (ISO instant), as an ISO instant; undefined when none within 8 years. */
export function nextAfter(c: Cron, from: string): string | undefined {
  const start = Math.floor(Date.parse(from) / 60_000) * 60_000 + 60_000;
  const day0 = Math.floor(start / 86_400_000) * 86_400_000;
  for (let n = 0; n <= CRON_HORIZON_DAYS; n++) {
    const midnight = day0 + n * 86_400_000;
    if (!dayMatches(c, new Date(midnight))) continue;
    for (const h of c.hours)
      for (const m of c.minutes) {
        const t = midnight + h * 3_600_000 + m * 60_000;
        if (t >= start) return new Date(t).toISOString();
      }
  }
  return undefined;
}
