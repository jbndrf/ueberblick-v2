/**
 * Durations. An exact duration (`days(n)`) is a number of milliseconds. A duration with calendar months
 * (`months(n)`) is `{ $months, $ms }`: adding it to a date adds calendar months and clamps to the end of
 * the month (Jan 31 + 1 month = Feb 28/29). `$` keys cannot be written in a map literal, so no expression
 * can forge one.
 */
import type { EvalValue } from '../contract';
import { isMap, toInstant, toMs } from '../functions/support';

export interface Dur {
  readonly months: number;
  readonly ms: number;
}

export const monthsValue = (months: number): EvalValue => ({ $months: months, $ms: 0 });

export function toDur(v: EvalValue): Dur | undefined {
  if (typeof v === 'number') return { months: 0, ms: v };
  if (isMap(v) && typeof v['$months'] === 'number' && typeof v['$ms'] === 'number')
    return { months: v['$months'], ms: v['$ms'] };
  return undefined;
}

/** A plain number when there are no months, so exact durations compare and order as numbers. */
export const fromDur = (d: Dur): EvalValue => (d.months === 0 ? d.ms : { $months: d.months, $ms: d.ms });

export const negateDur = (d: Dur): Dur => ({ months: -d.months, ms: -d.ms });

export const sumDur = (a: Dur, b: Dur): Dur => ({ months: a.months + b.months, ms: a.ms + b.ms });

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** `instant + d` (or minus, with a negated `d`): calendar months first, clamped, then the exact part. */
export function shift(instant: string, d: Dur): string {
  const t = new Date(toMs(instant));
  const index = t.getUTCFullYear() * 12 + t.getUTCMonth() + d.months;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const day = Math.min(t.getUTCDate(), daysInMonth(year, month));
  const base = Date.UTC(
    year,
    month,
    day,
    t.getUTCHours(),
    t.getUTCMinutes(),
    t.getUTCSeconds(),
    t.getUTCMilliseconds(),
  );
  return toInstant(base + d.ms);
}
