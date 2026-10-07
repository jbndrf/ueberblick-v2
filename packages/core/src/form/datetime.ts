/**
 * Typing of date and time values at the form boundary (WP-835). Pure: the device supplies its UTC offset
 * (minutes east of UTC), core never reads a clock or a zone (R2). A `datetime-local` input holds the device's
 * wall-clock time without an offset; the stored value is an instant (`type.ts` requires `Z` or an offset).
 */
import type { Json } from '../model';

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const MS_PER_MINUTE = 60_000;

/** The wall-clock text of a `datetime-local` input ("2026-05-01T10:30") at `offsetMinutes` east of UTC -> an ISO instant (Z). Anything else passes through. */
export function localToInstant(local: string, offsetMinutes: number): string {
  const m = LOCAL.exec(local);
  if (m === null) return local;
  const n = (i: number): number => Number(m[i] ?? 0);
  const ms = Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6)) - offsetMinutes * MS_PER_MINUTE;
  return Number.isNaN(ms) ? local : new Date(ms).toISOString();
}

/** A stored instant -> the wall-clock text a `datetime-local` input shows at `offsetMinutes` east of UTC. Anything unparsable passes through. */
export function instantToLocal(instant: string, offsetMinutes: number): string {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms) || LOCAL.test(instant)) return instant;
  return new Date(ms + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 16);
}

/**
 * A computed or prefilled value typed for its property: a `date` property holds the calendar date, so a
 * timestamp (`today()` is UTC midnight, docs/06) keeps its date part. Other types are unchanged.
 */
export function typedForProperty(type: string | undefined, value: Json): Json {
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return value.slice(0, 10);
  return value;
}
