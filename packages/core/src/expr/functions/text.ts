/** Text functions (and `size`, which also measures lists and maps). */
import { T, listOf, mapOf } from '../check/ty';
import type { FunctionSig } from '../check/types';
import type { Frag } from '../sql/frag';
import { lowerText, upperText } from '../sql/appFunctions';
import { cat, unsupported } from '../sql/frag';
import { matchesPattern } from '../pattern';
import { defineFunction, type SqlCall } from './define';
import { fail, isMap } from './support';

const str = (v: unknown): string => (typeof v === 'string' ? v : fail('needs a string'));

/** Length in Unicode code points, as CEL counts. */
function codePoints(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) i++;
    n++;
  }
  return n;
}

const anyList = listOf(T.dyn);
const anyMap = mapOf(T.dyn, T.dyn);
const sizeSigs: readonly FunctionSig[] = [
  { params: [T.string], returns: T.int },
  { params: [anyList], returns: T.int },
  { params: [anyMap], returns: T.int },
  { target: T.string, params: [], returns: T.int },
  { target: anyList, params: [], returns: T.int },
  { target: anyMap, params: [], returns: T.int },
];

/** Text arguments of a translated call (the receiver first). */
const arg = (call: SqlCall, i: number) => (call.args[i] as SqlCall['args'][number]).frag;

export const size = defineFunction({
  name: 'size',
  sigs: sizeSigs,
  sql: (call) => {
    const a = call.args[0] as SqlCall['args'][number];
    if (a.ty.kind === 'string') return cat('length(', a.frag, ')');
    if (a.ty.kind === 'list') return cat('json_array_length(', a.frag, ')');
    return unsupported('size of a map');
  },
  evaluate: ({ target, args }) => {
    const v = target ?? args[0];
    if (typeof v === 'string') return codePoints(v);
    if (Array.isArray(v)) return v.length;
    if (isMap(v)) return Object.keys(v).length;
    return fail('size needs a string, list or map');
  },
});

const receiver = (name: string, test: (s: string, t: string) => boolean, sql: (s: Frag, t: Frag) => Frag) =>
  defineFunction({
    name,
    sigs: [{ target: T.string, params: [T.string], returns: T.bool }],
    evaluate: ({ target, args }) => test(str(target), str(args[0])),
    sql: (call) => sql(arg(call, 0), arg(call, 1)),
  });

// `instr` finds the first occurrence, so a prefix is exactly "found at 1"; an empty needle is found at 1.
export const startsWith = receiver(
  'startsWith',
  (s, t) => s.startsWith(t),
  (s, t) => cat('(instr(', s, ', ', t, ') = 1)'),
);
export const endsWith = receiver(
  'endsWith',
  (s, t) => s.endsWith(t),
  (s, t) =>
    cat(
      '(CASE WHEN ',
      s,
      ' IS NULL OR ',
      t,
      ' IS NULL THEN NULL WHEN length(',
      t,
      ') = 0 THEN 1 ELSE substr(',
      s,
      ', -length(',
      t,
      ')) = ',
      t,
      ' END)',
    ),
);

// SQLite's own lower/upper fold ASCII only, so these call functions the driver registers (SQL_APP_FUNCTIONS),
// which run the very code `evaluate` runs (docs/06 "Parity").
export const lower = defineFunction({
  name: 'lower',
  sigs: [{ target: T.string, params: [], returns: T.string }],
  evaluate: ({ target }) => lowerText(str(target)),
  sql: (call) => cat('ub_lower(', arg(call, 0), ')'),
});

export const upper = defineFunction({
  name: 'upper',
  sigs: [{ target: T.string, params: [], returns: T.string }],
  evaluate: ({ target }) => upperText(str(target)),
  sql: (call) => cat('ub_upper(', arg(call, 0), ')'),
});

// `matches` has no SQL encoding: SQLite has no regular expressions without a user-defined function, and a
// UDF would be a second matcher (R1). `toSql` reports it as unsupported, so a `visible_when` that uses it is
// evaluated in core (docs/06 "matches").
export const matches = defineFunction({
  name: 'matches',
  sigs: [
    { params: [T.string, T.string], returns: T.bool },
    { target: T.string, params: [T.string], returns: T.bool },
  ],
  evaluate: ({ target, args }) => {
    const [text, pattern] = target === undefined ? [args[0], args[1]] : [target, args[0]];
    return matchesPattern(str(text), str(pattern)) ?? fail('matches() needs a valid pattern');
  },
});

/** The string form of `contains`; the spatial overload lives in spatial.ts (one name, one entry). */
export const stringContains = (s: unknown, t: unknown): boolean => str(s).includes(str(t));

export const TEXT_FUNCTIONS = [size, startsWith, endsWith, lower, upper, matches];
