/**
 * The v3 formula language (arithmetic on `{field}` references, comparisons, `and`/`or`/`not`,
 * `if(c, a, b)`) as rule-language expressions. Its other functions (min, max, round, obs_* ...) have
 * no v4 equivalent, so a formula that uses them is not converted. Operands must have the kind that
 * the operator needs (numbers for arithmetic, yes/no for logic), as v3 required at run time.
 */
import { valueProp, type Note, type PropInfo } from './ctx';
import { access, compareKind, isNumeric, type ExprEnv } from './exprs';

export interface Formula {
  readonly expr: string;
  /** True when the formula gives yes/no (a comparison or logic), false when it gives a number. */
  readonly bool: boolean;
}

/** True when a v3 value is a formula (has a {field} reference or a function call), else a literal. */
export const isFormula = (s: string): boolean => /\{[^}]+\}|[a-z_][a-z0-9_]*\(/.test(s);

const UNSUPPORTED = /\b(count|min|max|sum|avg|round|floor|ceil|abs|if_empty|obs_[a-z_]+)\s*\(/;

/** A parsed part: its text and the kind of value it gives (`number`, `boolean`, or the compare kind of a property). */
interface Term {
  s: string;
  k: string;
}

export function formula(src: string, env: ExprEnv): Formula | undefined {
  if (UNSUPPORTED.test(src)) return undefined;
  const tokens = src.match(/\{[^}]+\}|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|>=|<=|!=|[-+*/%()=<>,]/g);
  if (!tokens || tokens.join('').length < src.replace(/\s+/g, '').length) return undefined;
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const eat = (t: string): boolean => (tokens[pos] === t ? (pos++, true) : false);
  const fail = (): never => {
    throw new SyntaxError('formula');
  };
  const need = (t: Term, kind: string): Term => (t.k === kind ? t : fail());
  const primary = (): Term => {
    const t = peek();
    if (t === undefined) return fail();
    pos++;
    if (t === '(') {
      const e = or();
      if (!eat(')')) fail();
      return { s: `(${e.s})`, k: e.k };
    }
    if (t === '-') {
      const e = need(primary(), 'number');
      return { s: `-${e.s}`, k: 'number' };
    }
    if (t.startsWith('{')) {
      const pi = valueProp(env.type, t.slice(1, -1).replace(/^@[a-z]+\//, ''));
      if (!pi || (env.noSelf && !env.form?.has(pi.v3Key))) return fail();
      return { s: access(pi, env), k: compareKind(pi) };
    }
    if (/^\d/.test(t)) return { s: t, k: 'number' };
    if (t === 'if' && eat('(')) {
      const c = need(or(), 'boolean');
      eat(',');
      const a = or();
      eat(',');
      const b = or();
      if (!eat(')') || a.k !== b.k) fail();
      return { s: `(${c.s} ? ${a.s} : ${b.s})`, k: a.k };
    }
    return fail();
  };
  const bin = (next: () => Term, ops: string[]) => (): Term => {
    let left = next();
    for (let t = peek(); t !== undefined && ops.includes(t); t = peek()) {
      pos++;
      left = { s: `${need(left, 'number').s} ${t} ${need(next(), 'number').s}`, k: 'number' };
    }
    return left;
  };
  const add = bin(bin(primary, ['*', '/', '%']), ['+', '-']);
  const cmp = (): Term => {
    const left = add();
    const t = peek();
    if (t !== undefined && ['=', '!=', '>', '>=', '<', '<='].includes(t)) {
      pos++;
      const right = add();
      if (left.k !== right.k) fail();
      return { s: `${left.s} ${t === '=' ? '==' : t} ${right.s}`, k: 'boolean' };
    }
    return left;
  };
  const not = (): Term => (eat('not') ? { s: `!(${need(not(), 'boolean').s})`, k: 'boolean' } : cmp());
  const and = (): Term => {
    let left = not();
    while (eat('and'))
      left = { s: `${need(left, 'boolean').s} && ${need(not(), 'boolean').s}`, k: 'boolean' };
    return left;
  };
  const or = (): Term => {
    let left = and();
    while (eat('or')) left = { s: `${need(left, 'boolean').s} || ${need(and(), 'boolean').s}`, k: 'boolean' };
    return left;
  };
  try {
    const out = or();
    return pos === tokens.length ? { expr: out.s, bool: out.k === 'boolean' } : undefined;
  } catch {
    return undefined;
  }
}

/** A formula as a value for `pi`: `undefined` (and a note) when it cannot be converted or its result type does not fit. */
export function formulaFor(src: string, env: ExprEnv, pi: PropInfo, note: Note): string | undefined {
  const f = formula(src, env);
  if (!f) {
    note(
      'dropped',
      `the formula "${src}" cannot be converted: it uses functions, fields or type combinations that the rule language does not have`,
    );
    return undefined;
  }
  const fits = isNumeric(pi) ? !f.bool : pi.type === 'boolean' ? f.bool : false;
  if (!fits) {
    note(
      'dropped',
      `the formula gives a ${f.bool ? 'yes/no value' : 'number'}, but ${pi.v3Key} is of type ${pi.type}`,
    );
    return undefined;
  }
  return f.expr;
}
