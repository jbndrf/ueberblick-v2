/** Value matching for scenario expectations: alias substitution, `{approx}`, subset comparison. */
import type { Json } from '../../../packages/core/src/model';
import type { Aliases } from '../../../packages/core/src/testing';

export type Loose = unknown;
export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Replace strings that name a feature alias by its id (deep). Only whole-string matches. */
export function withIds(value: unknown, aliases: Aliases): Json {
  if (typeof value === 'string') return (aliases.has(value) ? aliases.id(value) : value) as Json;
  if (Array.isArray(value)) return value.map((v) => withIds(v, aliases));
  if (isRec(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withIds(v, aliases)]));
  return value as Json;
}

/** Does `actual` satisfy `expected`? Numbers may use `{approx, rel_tol|abs_tol}`; objects match as subsets. */
export function matches(expected: unknown, actual: unknown): boolean {
  if (isRec(expected) && 'approx' in expected && typeof expected['approx'] === 'number') {
    if (typeof actual !== 'number') return false;
    const tol =
      typeof expected['abs_tol'] === 'number'
        ? expected['abs_tol']
        : Math.abs(expected['approx']) * (typeof expected['rel_tol'] === 'number' ? expected['rel_tol'] : 1e-9);
    return Math.abs(actual - expected['approx']) <= tol;
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matches(e, actual[i]));
  }
  if (isRec(expected)) {
    return isRec(actual) && Object.entries(expected).every(([k, v]) => matches(v, actual[k]));
  }
  return expected === actual;
}
