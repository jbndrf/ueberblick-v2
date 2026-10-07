/** Number functions. */
import { T } from '../check/ty';
import { defineFunction, type SqlCall } from './define';
import { cat } from '../sql/frag';
import { fail } from './support';

/** The most decimal places a step may have: more would lose exactness in a double. */
export const MULTIPLE_OF_MAX_PLACES = 9;

const arg = (call: SqlCall, i: number) => (call.args[i] as SqlCall['args'][number]).frag;

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail('multiple_of needs finite numbers');

/** The decimal places of a number as written (`0.25` is 2; `1e-7` is 7). */
function places(n: number): number {
  const [mantissa = '', exp = '0'] = String(n).split('e');
  const frac = (mantissa.split('.')[1] ?? '').length;
  return Math.max(0, frac - Number(exp));
}

/**
 * True when `value` is a whole multiple of `step`, exact in decimal: both are scaled by the step's decimal places
 * and rounded away from binary noise, so 0.3 is a multiple of 0.1 and 2.5 of 0.5.
 */
export function isMultipleOf(value: number, step: number): boolean {
  if (!(step > 0)) return fail('multiple_of needs a step above 0');
  const p = places(step);
  if (p > MULTIPLE_OF_MAX_PLACES)
    return fail(`multiple_of needs a step with at most ${MULTIPLE_OF_MAX_PLACES} decimal places`);
  const scale = 10 ** p;
  const v = Number((value * scale).toPrecision(12));
  const s = Math.round(step * scale);
  return Number.isInteger(v) && v % s === 0;
}

// SQLite has no exact decimal remainder, so the SQL form calls `ub_multiple_of`, which the driver registers
// (SQL_APP_FUNCTIONS) and which runs `isMultipleOf`: one implementation (R1, docs/06 "multiple_of").
export const multipleOf = defineFunction({
  name: 'multiple_of',
  sigs: [{ params: [T.double, T.double], returns: T.bool }],
  evaluate: ({ args }) => isMultipleOf(num(args[0]), num(args[1])),
  sql: (call) => cat('ub_multiple_of(', arg(call, 0), ', ', arg(call, 1), ')'),
});

export const NUMBER_FUNCTIONS = [multipleOf];
