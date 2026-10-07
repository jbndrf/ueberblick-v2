/**
 * SQL functions that the SQLite driver must register because SQLite has no equivalent (A-001 seam: the driver
 * takes this list through the `Db` interface, nothing else registers functions). Each one calls the same code
 * as `evaluate`, so both backends fold, clamp and compare identically (R1). A value of the wrong type gives
 * null, which a condition treats like an evaluation error: it does not hold.
 */
import { shift } from '../evaluate/duration';
import { isMultipleOf } from '../functions/numbers';

export interface SqlAppFunction {
  readonly name: string;
  readonly arity: number;
  /** Arguments arrive as SQLite hands them over: string, number, bigint, Uint8Array or null. */
  readonly fn: (...args: readonly unknown[]) => string | number | null;
}

/** Unicode case folding, exactly what `evaluate` does (SQLite's own `lower` folds ASCII only). */
export const lowerText = (s: string): string => s.toLowerCase();
export const upperText = (s: string): string => s.toUpperCase();

/** `ts` shifted by `months` calendar months, clamped to the end of the month (evaluate's `shift`). */
export function addMonths(ts: unknown, months: unknown): string | null {
  if (typeof ts !== 'string' || typeof months !== 'number' || !Number.isFinite(months)) return null;
  try {
    return shift(ts, { months, ms: 0 });
  } catch {
    return null;
  }
}

/** `multiple_of` for SQLite: 1 or 0, from the very check `evaluate` runs; non-numbers and a bad step give null. */
export function multipleOfSql(value: unknown, step: unknown): number | null {
  if (typeof value !== 'number' || typeof step !== 'number') return null;
  try {
    return isMultipleOf(value, step) ? 1 : 0;
  } catch {
    return null;
  }
}

export const SQL_APP_FUNCTIONS: readonly SqlAppFunction[] = [
  { name: 'ub_lower', arity: 1, fn: (s) => (typeof s === 'string' ? lowerText(s) : null) },
  { name: 'ub_upper', arity: 1, fn: (s) => (typeof s === 'string' ? upperText(s) : null) },
  { name: 'ub_add_months', arity: 2, fn: addMonths },
  { name: 'ub_multiple_of', arity: 2, fn: multipleOfSql },
];
