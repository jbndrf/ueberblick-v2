/**
 * SQL for the operators that are not `&&`/`||`. Null follows the rule language: `==` and `!=` use `IS`,
 * so they never give null; everything else propagates SQL null, which is what CEL does. A `dyn` operand
 * (untyped JSON) is guarded by its storage type, because SQLite would order text against numbers where
 * the rule language reports an error (and an error means the condition does not hold).
 */
import type { ExprBinaryOperator } from '../../registry';
import type { Ty } from '../check/types';
import { cat, raw, unsupported, type Frag } from './frag';

const NUMERIC = new Set<string>(['int', 'double', 'duration']);
const TEXTUAL = new Set<string>(['string', 'timestamp']);
const COMPARE: Readonly<Partial<Record<ExprBinaryOperator, string>>> = {
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};

/** Timestamp text as `date()` writes it; SQLite's `strftime` produces the same form. */
export const ISO_FORMAT = "'%Y-%m-%dT%H:%M:%fZ'";

function guarded(f: Frag, ty: Ty, other: Ty): Frag {
  if (ty.kind !== 'dyn') return f;
  if (NUMERIC.has(other.kind))
    return cat('(CASE WHEN typeof(', f, ") IN ('integer', 'real') THEN ", f, ' END)');
  if (TEXTUAL.has(other.kind)) return cat('(CASE WHEN typeof(', f, ") = 'text' THEN ", f, ' END)');
  return unsupported('a dynamically typed value next to another one');
}

const seconds = (ms: Frag, sign: '+' | '-'): Frag =>
  cat("printf('%+.3f seconds', ", sign === '-' ? '-(' : '(', ms, ') / 1000.0)');

const epoch = (f: Frag): Frag => cat('unixepoch(', f, ", 'subsec')");

export interface Operands {
  readonly l: Frag;
  readonly r: Frag;
  readonly lt: Ty;
  readonly rt: Ty;
}

function notContainer(t: Ty): void {
  if (t.kind === 'list' || t.kind === 'map' || t.kind === 'record' || t.kind === 'geometry')
    unsupported(`comparing ${t.kind} values`);
}

/** `+ - * / %` and the comparisons; `in`, `&&` and `||` are handled by the translator. */
export function binarySql(op: ExprBinaryOperator, o: Operands): Frag {
  const { lt, rt } = o;
  if (op === '==' || op === '!=') {
    notContainer(lt);
    notContainer(rt);
    return cat('(', o.l, op === '==' ? ' IS ' : ' IS NOT ', o.r, ')');
  }
  const cmp = COMPARE[op];
  if (cmp !== undefined) {
    return cat('(', guarded(o.l, lt, rt), ` ${cmp} `, guarded(o.r, rt, lt), ')');
  }
  return arithmetic(op, o);
}

/** A plain column read (`f.pinned_version`), as against a `json_extract` of a property. */
const COLUMN_REF = /^\w+\.\w+$/;

/**
 * `col IS ?` cannot use a partial index `WHERE col IS NOT NULL` (the parameter may be null). For `col == <constant that
 * is not null>`, `col IS NOT NULL` is implied: say it, and the planner may search the index (`$version`, A-029). The
 * result is the same for every row, also under `!`. Only a plain column gets it, never a property read.
 */
export const impliedNotNull = (eq: Frag, col: Frag): Frag =>
  COLUMN_REF.test(col.sql) ? cat('(', eq, ' AND ', col, ' IS NOT NULL)') : eq;

function arithmetic(op: ExprBinaryOperator, o: Operands): Frag {
  const { lt, rt } = o;
  const lk = lt.kind;
  const rk = rt.kind;
  if (op === '+' && (lk === 'timestamp' || rk === 'timestamp')) {
    const [ts, dur] = lk === 'timestamp' ? [o.l, o.r] : [o.r, o.l];
    return cat('strftime(', raw(ISO_FORMAT), ', ', ts, ', ', seconds(dur, '+'), ')');
  }
  if (op === '-' && lk === 'timestamp' && rk === 'timestamp')
    return cat('CAST(round((', epoch(o.l), ' - ', epoch(o.r), ') * 1000) AS INTEGER)');
  if (op === '-' && lk === 'timestamp')
    return cat('strftime(', raw(ISO_FORMAT), ', ', o.l, ', ', seconds(o.r, '-'), ')');
  if (op === '+' && (lk === 'string' || rk === 'string')) {
    return cat('(', guarded(o.l, lt, rt), ' || ', guarded(o.r, rt, lt), ')');
  }
  if (lk === 'list' || rk === 'list') return unsupported('list concatenation');
  const numeric = NUMERIC.has(lk) || NUMERIC.has(rk);
  if (!numeric) return unsupported(`operator '${op}' on ${lk} and ${rk}`);
  const a = guarded(o.l, lt, rt);
  const b = guarded(o.r, rt, lt);
  if (op === '/') {
    // int / int truncates (both stored ints and bound doubles need the cast); otherwise it is floating point
    return lk === 'int' && rk === 'int'
      ? cat('(CAST(', a, ' AS INTEGER) / CAST(', b, ' AS INTEGER))')
      : cat('(CAST(', a, ' AS REAL) / ', b, ')');
  }
  if (op === '%') return cat('(CAST(', a, ' AS INTEGER) % CAST(', b, ' AS INTEGER))');
  return cat('(', a, ` ${op} `, b, ')');
}

export const unaryMinus = (f: Frag, t: Ty): Frag =>
  t.kind === 'dyn' ? unsupported('negating a dynamically typed value') : cat('(-', f, ')');

export const not = (f: Frag): Frag => cat('(NOT ', f, ')');
