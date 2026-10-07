/**
 * Property test (WP-127): the compiled evaluation, with its fast paths, equals a plain tree-walk on random
 * well-typed expressions. The tree-walk is the reference of docs/06 (Kleene logic with CEL error
 * absorption, null propagation, total arithmetic) and lives only here (R1: production has one evaluator).
 * Faults are compared by message; spans are covered by evaluate.spec.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Expr } from '../ast';
import { T, check, type Env } from '../check';
import type { EvalValue } from '../contract';
import { evalContext } from '../__fixtures__/eval-cases';
import { FUNCTIONS } from '../functions';
import { EvalFault, deepEqual } from '../functions/support';
import { parse } from '../parse';
import { evaluate } from '.';
import { add, contains, div, mod, mul, negate, order, sub, valueKind } from './ops';

const ENV: Env = {
  vars: {
    a: T.int,
    b: T.int,
    p: T.bool,
    q: T.bool,
    s: T.string,
    l: { kind: 'list', element: T.int },
    x: T.double,
  },
  features: {},
};

type Res = { readonly v: EvalValue } | { readonly fault: string };
const val = (v: EvalValue): Res => ({ v });
const fault = (message: string): Res => ({ fault: message });

/** Runs a function that may throw an `EvalFault` and captures it as a result. */
function guard(f: () => EvalValue): Res {
  try {
    return val(f());
  } catch (e) {
    if (e instanceof EvalFault) return fault(e.message);
    throw e;
  }
}

function asBool(r: Res, what: string): boolean | null | { readonly fault: string } {
  if ('fault' in r) return r;
  const v = r.v;
  if (typeof v === 'boolean' || v === null) return v;
  return { fault: `${what} needs a bool but got ${valueKind(v)}` };
}

function logic(op: '&&' | '||', l: Res, right: () => Res): Res {
  const isOr = op === '||';
  const what = `operator '${op}'`;
  const a = asBool(l, what);
  if (a === isOr) return val(isOr);
  const b = asBool(right(), what);
  if (b === isOr) return val(isOr);
  if (a !== null && typeof a === 'object') return a;
  if (b !== null && typeof b === 'object') return b;
  return val(a === null || b === null ? null : !isOr);
}

function walk(e: Expr, vars: ReadonlyMap<string, EvalValue>, ints: (x: Expr) => boolean): Res {
  const w = (x: Expr) => walk(x, vars, ints);
  switch (e.kind) {
    case 'literal':
      return val(e.value);
    case 'ident': {
      const v = vars.get(e.name);
      return v === undefined ? fault(`unknown name '${e.name}'`) : val(v);
    }
    case 'list': {
      const items: EvalValue[] = [];
      for (const x of e.elements) {
        const r = w(x);
        if ('fault' in r) return r;
        items.push(r.v);
      }
      return val(items);
    }
    case 'unary': {
      const o = w(e.operand);
      if ('fault' in o || o.v === null) return o;
      if (e.op === '-') return guard(() => negate(o.v));
      return typeof o.v === 'boolean'
        ? val(!o.v)
        : fault(`operator '!' needs a bool but got ${valueKind(o.v)}`);
    }
    case 'conditional': {
      const t = w(e.test);
      if ('fault' in t || t.v === null) return t;
      if (typeof t.v !== 'boolean')
        return fault(`the condition of ?: needs a bool but got ${valueKind(t.v)}`);
      return t.v ? w(e.then) : w(e.else);
    }
    case 'index': {
      const o = w(e.object);
      if ('fault' in o) return o;
      const i = w(e.index);
      if ('fault' in i) return i;
      if (o.v === null || i.v === null) return val(null);
      if (Array.isArray(o.v)) {
        if (typeof i.v !== 'number' || !Number.isInteger(i.v)) return fault('a list index must be an int');
        if (i.v < 0 || i.v >= o.v.length) return fault('the list index is out of range');
        return val(o.v[i.v] as EvalValue);
      }
      return fault(`cannot index ${valueKind(o.v)}`);
    }
    case 'call': {
      const def = FUNCTIONS.get(e.name);
      if (!def) return fault(`unknown function '${e.name}'`);
      const t = e.target ? w(e.target) : undefined;
      if (t && 'fault' in t) return t;
      if (t && t.v === null) return val(null);
      const args: EvalValue[] = [];
      for (const a of e.args) {
        const r = w(a);
        if ('fault' in r) return r;
        if (r.v === null) return val(null);
        args.push(r.v);
      }
      return guard(() => def.evaluate({ target: t?.v, args }, { ctx: evalContext() }));
    }
    case 'binary': {
      const l = w(e.left);
      if (e.op === '&&' || e.op === '||') return logic(e.op, l, () => w(e.right));
      if ('fault' in l) return l;
      const r = w(e.right);
      if ('fault' in r) return r;
      const a = l.v;
      const b = r.v;
      const isInts = ints(e.left) && ints(e.right);
      if (e.op === '==' || e.op === '!=') return val(deepEqual(a, b) === (e.op === '=='));
      if (e.op === 'in') return b === null ? val(null) : guard(() => contains(a, b, deepEqual));
      if (a === null || b === null) return val(null);
      switch (e.op) {
        case '<':
          return guard(() => order(a, b, false) < 0);
        case '<=':
          return guard(() => order(a, b, false) <= 0);
        case '>':
          return guard(() => order(a, b, false) > 0);
        case '>=':
          return guard(() => order(a, b, false) >= 0);
        case '+':
          return guard(() => add(a, b, isInts));
        case '-':
          return guard(() => sub(a, b, isInts));
        case '*':
          return guard(() => mul(a, b, isInts));
        case '/':
          return guard(() => div(a, b, isInts));
        case '%':
          return guard(() => mod(a, b));
      }
      return fault('unsupported operator');
    }
    default:
      return fault(`unsupported ${e.kind}`);
  }
}

const int: fc.Arbitrary<string> = fc.letrec<{ i: string; b: string; d: string; t: string }>((tie) => ({
  i: fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom('a', 'b', '0', '1', '7') },
    { weight: 1, arbitrary: fc.constantFrom('l[a]', 'l[0]', 'size(s)', 'l[b]') },
    {
      weight: 2,
      arbitrary: fc
        .tuple(tie('i'), fc.constantFrom('+', '-', '*', '/', '%'), tie('i'))
        .map(([x, o, y]) => `(${x} ${o} ${y})`),
    },
    { weight: 1, arbitrary: tie('i').map((x) => `(-${x})`) },
    {
      weight: 1,
      arbitrary: fc.tuple(tie('b'), tie('i'), tie('i')).map(([c, x, y]) => `(${c} ? ${x} : ${y})`),
    },
  ),
  d: fc.constantFrom('x', '1.5', '(x * 2.0)', '(x / 0.0)'),
  t: fc.constantFrom('s', "'aktiv'", "'x'", "(s + 'x')"),
  b: fc.oneof(
    { weight: 2, arbitrary: fc.constantFrom('p', 'q', 'true', 'false') },
    {
      weight: 3,
      arbitrary: fc
        .tuple(tie('i'), fc.constantFrom('==', '!=', '<', '<=', '>', '>='), tie('i'))
        .map(([x, o, y]) => `(${x} ${o} ${y})`),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(tie('d'), fc.constantFrom('==', '<', '>='), tie('d'))
        .map(([x, o, y]) => `(${x} ${o} ${y})`),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(tie('t'), fc.constantFrom('==', '!='), tie('t'))
        .map(([x, o, y]) => `(${x} ${o} ${y})`),
    },
    { weight: 1, arbitrary: fc.tuple(tie('i'), tie('i')).map(([x, y]) => `(${x} in [${y}, 3, a])`) },
    { weight: 1, arbitrary: fc.constantFrom("s.startsWith('a')", "s.endsWith('x')", "'a' in ['a', s]") },
    {
      weight: 4,
      arbitrary: fc
        .tuple(tie('b'), fc.constantFrom('&&', '||'), tie('b'))
        .map(([x, o, y]) => `(${x} ${o} ${y})`),
    },
    {
      weight: 2,
      arbitrary: fc
        .array(tie('b'), { minLength: 3, maxLength: 5 })
        .chain((xs) => fc.constantFrom('&&', '||').map((o) => xs.join(` ${o} `))),
    },
    { weight: 1, arbitrary: tie('b').map((x) => `(!${x})`) },
    {
      weight: 1,
      arbitrary: fc.tuple(tie('b'), tie('b'), tie('b')).map(([c, x, y]) => `(${c} ? ${x} : ${y})`),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(tie('b'), fc.constantFrom('==', '!='), tie('b'))
        .map(([x, o, y]) => `(${x} ${o} ${y})`),
    },
  ),
})).b;

const nullableBool = fc.constantFrom(true, false, null);
const small = fc.oneof(fc.integer({ min: -3, max: 3 }), fc.integer({ min: -1000, max: 1000 }));
const vars = fc.record({
  a: small,
  b: small,
  p: nullableBool,
  q: nullableBool,
  s: fc.constantFrom('', 'a', 'aktiv', 'x', 'ax'),
  l: fc.array(small, { maxLength: 4 }),
  x: fc.constantFrom(0, 1.5, -2.25, 100),
});

describe('compiled evaluation equals the tree-walk', () => {
  it('on random well-typed expressions, including faults, nulls and long chains', () => {
    let checked = 0;
    fc.assert(
      fc.property(int, vars, (src, v) => {
        const p = parse(src);
        if (!p.ok) throw new Error(`parse ${src}`);
        const c = check(p.ast, ENV);
        if (!c.ok) return; // not well typed: nothing to compare
        checked++;
        const m = new Map<string, EvalValue>(Object.entries(v) as [string, EvalValue][]);
        const ctx = { ...evalContext(), vars: m };
        const isInts = (x: Expr) => c.typed.types.get(x)?.kind === 'int';
        const want = walk(p.ast, m, isInts);
        const got = evaluate(c.typed, ctx);
        if ('fault' in want) {
          expect(got.ok ? got : got.error.message).toBe(want.fault);
        } else {
          expect(got).toEqual({ ok: true, value: want.v });
        }
      }),
      { numRuns: 3000 },
    );
    expect(checked).toBeGreaterThan(2000);
  });

  it('a fault deep inside nested chains is retried once per level, not exponentially often', () => {
    let src = '(a / b == 1)';
    for (let i = 0; i < 40; i++) src = `(p == ${src})`;
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const c = check(p.ast, ENV);
    if (!c.ok) throw new Error('check');
    const ctx = {
      ...evalContext(),
      vars: new Map<string, EvalValue>([
        ['a', 5],
        ['b', 0],
        ['p', true],
      ]),
    };
    const got = evaluate(c.typed, ctx);
    expect(got.ok).toBe(false);
  });
});
