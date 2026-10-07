/**
 * Operators on runtime values. Operands are never null here (the caller propagates null first).
 * Timestamps are ISO strings and durations are numbers (milliseconds): `timestamp + duration` is a
 * string plus a number, `timestamp - timestamp` a string minus a string; neither is otherwise valid.
 */
import type { EvalValue } from '../contract';
import { fail, isFeatureRef, isMap, parseInstant, toMs } from '../functions/support';
import { fromDur, negateDur, shift, sumDur, toDur } from './duration';

const kind = (v: EvalValue): string =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? 'list'
      : isFeatureRef(v)
        ? 'feature'
        : typeof v === 'object'
          ? 'map'
          : typeof v;

/** Applies the int and finite checks that make arithmetic total: no overflow, no NaN, no infinity. */
export function checked(n: number, ints: boolean): number {
  if (!Number.isFinite(n) || (ints && !Number.isSafeInteger(n))) return fail('arithmetic overflow');
  return n;
}

const isInstant = (v: EvalValue): v is string => typeof v === 'string' && parseInstant(v) !== undefined;

export function add(l: EvalValue, r: EvalValue, ints: boolean): EvalValue {
  if (typeof l === 'number' && typeof r === 'number') return checked(l + r, ints);
  if (typeof l === 'string' && typeof r === 'string') return l + r;
  if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
  const dl = toDur(l);
  const dr = toDur(r);
  if (isInstant(l) && dr) return shift(l, dr);
  if (isInstant(r) && dl) return shift(r, dl);
  if (dl && dr) return fromDur(sumDur(dl, dr));
  return fail(`cannot add ${kind(l)} and ${kind(r)}`);
}

export function sub(l: EvalValue, r: EvalValue, ints: boolean): EvalValue {
  if (typeof l === 'number' && typeof r === 'number') return checked(l - r, ints);
  const dl = toDur(l);
  const dr = toDur(r);
  if (isInstant(l) && dr) return shift(l, negateDur(dr));
  if (isInstant(l) && isInstant(r)) return toMs(l) - toMs(r);
  if (dl && dr) return fromDur(sumDur(dl, negateDur(dr)));
  return fail(`cannot subtract ${kind(r)} from ${kind(l)}`);
}

export function mul(l: EvalValue, r: EvalValue, ints: boolean): EvalValue {
  if (typeof l === 'number' && typeof r === 'number') return checked(l * r, ints);
  return fail(`cannot multiply ${kind(l)} and ${kind(r)}`);
}

/** `ints`: both operands are statically `int`, so the division truncates. */
export function div(l: EvalValue, r: EvalValue, ints: boolean): EvalValue {
  if (typeof l !== 'number' || typeof r !== 'number') return fail(`cannot divide ${kind(l)} by ${kind(r)}`);
  if (r === 0) return fail('division by zero');
  return checked(ints ? Math.trunc(l / r) : l / r, ints);
}

export function mod(l: EvalValue, r: EvalValue): EvalValue {
  if (typeof l !== 'number' || typeof r !== 'number' || !Number.isInteger(l) || !Number.isInteger(r))
    return fail('the remainder needs int operands');
  if (r === 0) return fail('division by zero');
  return l % r;
}

export function negate(v: EvalValue): EvalValue {
  if (typeof v === 'number') return -v;
  const d = toDur(v);
  return d ? fromDur(negateDur(d)) : fail(`cannot negate ${kind(v)}`);
}

/** -1, 0 or 1. `time`: compare strings as instants. */
export function order(l: EvalValue, r: EvalValue, time: boolean): number {
  if (typeof l === 'number' && typeof r === 'number') return l < r ? -1 : l > r ? 1 : 0;
  if (typeof l === 'string' && typeof r === 'string') {
    if (time) {
      const a = toMs(l);
      const b = toMs(r);
      return a < b ? -1 : a > b ? 1 : 0;
    }
    return l < r ? -1 : l > r ? 1 : 0;
  }
  return fail(`cannot order ${kind(l)} and ${kind(r)}`);
}

/** Equality of instants written differently ('2026-01-01' and '2026-01-01T00:00:00Z'). */
export function sameInstant(l: string, r: string): boolean {
  const a = parseInstant(l);
  const b = parseInstant(r);
  return a !== undefined && a === b;
}

/** `l in r`: membership in a list, or a key of a map. */
export function contains(
  l: EvalValue,
  r: EvalValue,
  equal: (a: EvalValue, b: EvalValue) => boolean,
): boolean {
  if (Array.isArray(r)) return r.some((x) => equal(l, x));
  if (isMap(r)) return typeof l === 'string' && Object.hasOwn(r, l);
  return fail(`'in' needs a list or map, not ${kind(r)}`);
}

export { kind as valueKind };
