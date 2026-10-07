/**
 * Shared helpers of evaluation and the function registry: the fault type, value tests and time parsing.
 * Pure: no clock, no random source (R2). `Date.parse` and `Date.UTC` only read their arguments.
 */
import type { Span } from '../ast';
import type { EvalValue, FeatureRef } from '../contract';

/** Thrown inside evaluation; `evaluate` turns it into an error result. Never escapes the module. */
export class EvalFault extends Error {
  constructor(
    message: string,
    readonly span?: Span,
  ) {
    super(message);
  }
}

export function fail(message: string): never {
  throw new EvalFault(message);
}

export type EvalMap = { readonly [key: string]: EvalValue };

export function isFeatureRef(v: unknown): v is FeatureRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && '$feature' in v;
}

/** A plain map (a JSON object that is not a feature reference). */
export function isMap(v: unknown): v is EvalMap {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !('$feature' in v);
}

export function isList(v: unknown): v is readonly EvalValue[] {
  return Array.isArray(v);
}

export function deepEqual(a: EvalValue, b: EvalValue): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i] as EvalValue, b[i] as EvalValue)) return false;
    return true;
  }
  if (isFeatureRef(a) || isFeatureRef(b))
    return isFeatureRef(a) && isFeatureRef(b) && a.$feature === b.$feature;
  const am = a as EvalMap;
  const bm = b as EvalMap;
  const ka = Object.keys(am);
  if (ka.length !== Object.keys(bm).length) return false;
  for (const k of ka) {
    if (!(k in bm) || !deepEqual(am[k] as EvalValue, bm[k] as EvalValue)) return false;
  }
  return true;
}

export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_MINUTE = 60_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** Strict ISO 8601: a calendar date, or a date-time that names its offset (never local time). */
export function parseInstant(s: string): number | undefined {
  if (!DATE_RE.test(s)) return undefined;
  // Days 1 to 28 exist in every month, so only the rest needs the calendar check (hot path: no allocation).
  const d = (s.charCodeAt(8) - 48) * 10 + (s.charCodeAt(9) - 48);
  if (d < 1 || d > 28) {
    const y = Number(s.slice(0, 4));
    const mo = Number(s.slice(5, 7));
    if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return undefined;
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Milliseconds since the epoch of a timestamp value (an ISO string). */
export function toMs(v: EvalValue): number {
  const ms = typeof v === 'string' ? parseInstant(v) : undefined;
  if (ms === undefined) return fail('not a valid date');
  return ms;
}

export function toInstant(ms: number): string {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return fail('date out of range');
  return new Date(ms).toISOString();
}
