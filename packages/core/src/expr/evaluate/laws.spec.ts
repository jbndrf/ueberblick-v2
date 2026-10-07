/** Property tests: operator laws and totality over random expressions (docs/06, H4). */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Expr } from '../ast';
import { T, check, type Env } from '../check';
import type { EvalContext, EvalValue } from '../contract';
import { EXPR_BINARY_OPERATORS, EXPR_MACROS, EXPR_UNARY_OPERATORS } from '../../registry';
import { evalContext } from '../__fixtures__/eval-cases';
import { FUNCTION_LIST } from '../functions';
import { parse } from '../parse';
import { evaluate } from '.';

const ENV: Env = {
  vars: {
    a: T.int,
    b: T.int,
    c: T.int,
    p: T.bool,
    q: T.bool,
    r: T.bool,
    s: T.string,
    l: { kind: 'list', element: T.int },
    x: T.double,
    y: T.double,
  },
  features: {},
};
const cache = new Map<string, ReturnType<typeof compile>>();
function compile(src: string) {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse ${src}`);
  const c = check(p.ast, ENV);
  if (!c.ok) throw new Error(`check ${src}: ${c.errors[0]?.message ?? ''}`);
  return c.typed;
}
function ev(src: string, vars: Record<string, EvalValue>): EvalValue {
  let t = cache.get(src);
  if (!t) cache.set(src, (t = compile(src)));
  const ctx: EvalContext = { ...evalContext(), vars: new Map(Object.entries(vars)) };
  const r = evaluate(t, ctx);
  if (!r.ok) throw new Error(`${src}: ${r.error.message}`);
  return r.value;
}

const small = fc.integer({ min: -1000, max: 1000 });
const bool = fc.boolean();
const dbl = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });

describe('operator laws', () => {
  it('+ and * commute and associate; - is antisymmetric; 0 and 1 are identities', () => {
    fc.assert(
      fc.property(small, small, small, (a, b, c) => {
        const v = { a, b, c };
        expect(ev('a + b == b + a', v)).toBe(true);
        expect(ev('a * b == b * a', v)).toBe(true);
        expect(ev('(a + b) + c == a + (b + c)', v)).toBe(true);
        expect(ev('(a * b) * c == a * (b * c)', v)).toBe(true);
        expect(ev('a - b == -(b - a)', v)).toBe(true);
        expect(ev('a + 0 == a && a * 1 == a', v)).toBe(true);
        expect(ev('a * (b + c) == a * b + a * c', v)).toBe(true);
      }),
    );
  });

  it('integer division and remainder: (a / b) * b + a % b == a', () => {
    fc.assert(
      fc.property(
        small,
        small.filter((n) => n !== 0),
        (a, b) => {
          expect(ev('(a / b) * b + a % b == a', { a, b })).toBe(true);
        },
      ),
    );
  });

  it('&& and || commute; De Morgan; double negation; absorption', () => {
    fc.assert(
      fc.property(bool, bool, bool, (p, q, r) => {
        const v = { p, q, r };
        expect(ev('(p && q) == (q && p)', v)).toBe(true);
        expect(ev('(p || q) == (q || p)', v)).toBe(true);
        expect(ev('!(p && q) == (!p || !q)', v)).toBe(true);
        expect(ev('!(p || q) == (!p && !q)', v)).toBe(true);
        expect(ev('!!p == p', v)).toBe(true);
        expect(ev('(p && (q || r)) == ((p && q) || (p && r))', v)).toBe(true);
        expect(ev('(p || (p && q)) == p', v)).toBe(true);
        expect(ev('(p ? q : r) == ((p && q) || (!p && r))', v)).toBe(true);
      }),
    );
  });

  it('comparison: order laws and == / != duality (ints and doubles mixed)', () => {
    fc.assert(
      fc.property(small, small, dbl, dbl, (a, b, x, y) => {
        expect(ev('(a < b) == !(a >= b)', { a, b })).toBe(true);
        expect(ev('(a <= b) == (a < b || a == b)', { a, b })).toBe(true);
        expect(ev('(a == b) == !(a != b)', { a, b })).toBe(true);
        expect(ev('(x < y) == (y > x)', { x, y })).toBe(true);
        expect(ev('a == a && x == x', { a, x })).toBe(true);
        expect(ev('(a < x) == (a + 0.0 < x)', { a, x })).toBe(true);
      }),
    );
  });

  it('strings and lists: concatenation is associative, size adds up, in finds members', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), small, (s, a) => {
        expect(ev("(s + 'x') + 'y' == s + ('x' + 'y')", { s })).toBe(true);
        expect(ev('size([a] + [a, a]) == 3', { a })).toBe(true);
        expect(ev('a in [a, 1]', { a })).toBe(true);
        expect(ev('(s + s).size() == 2 * s.size()', { s })).toBe(true);
      }),
    );
  });

  it('macros: exists is the negation of all-not; filter never grows; map keeps the size', () => {
    fc.assert(
      fc.property(fc.array(small, { maxLength: 12 }), small, (xs, k) => {
        const v = { l: xs, b: k };
        expect(ev('l.exists(i, i > b) == !l.all(i, i <= b)', v)).toBe(true);
        expect(ev('l.filter(i, i > b).size() <= l.size()', v)).toBe(true);
        expect(ev('l.map(i, i + 1).size() == l.size()', v)).toBe(true);
      }),
    );
  });
});

// --- totality over random (possibly ill-formed) ASTs ---------------------------------------------

const span = { start: 0, end: 1 };
const c = <V>(v: V) => fc.constant(v);
const names = ['self', 'x', 'now', 'nope', 'actor'];
const fields = ['stage', 'hoehe', 'flaeche', 'kontrollen', 'meta', 'nope', '$feature'];
const callNames = [...FUNCTION_LIST.map((f) => f.name), 'unknown'];
const macros = EXPR_MACROS.keys;
const unaries = EXPR_UNARY_OPERATORS.keys;
const binaries = EXPR_BINARY_OPERATORS.keys;

type Member = Extract<Expr, { kind: 'member' }>;

const expr: fc.Arbitrary<Expr> = fc.letrec<{ e: Expr; m: Member }>((tie) => ({
  m: fc.record({
    kind: c('member' as const),
    object: tie('e'),
    field: fc.constantFrom(...fields),
    span: c(span),
  }),
  e: fc.oneof(
    { depthSize: 'small', maxDepth: 5 },
    fc.record({ kind: c('literal' as const), type: c('int' as const), value: fc.integer(), span: c(span) }),
    fc.record({ kind: c('literal' as const), type: c('string' as const), value: fc.string(), span: c(span) }),
    fc.record({ kind: c('literal' as const), type: c('null' as const), value: c(null), span: c(span) }),
    fc.record({ kind: c('literal' as const), type: c('bool' as const), value: fc.boolean(), span: c(span) }),
    fc.record({ kind: c('ident' as const), name: fc.constantFrom(...names), span: c(span) }),
    tie('m'),
    fc.record({ kind: c('index' as const), object: tie('e'), index: tie('e'), span: c(span) }),
    fc
      .record({
        kind: c('call' as const),
        name: fc.constantFrom(...callNames),
        target: fc.option(tie('e'), { nil: undefined }),
        args: fc.array(tie('e'), { maxLength: 3 }),
        span: c(span),
      })
      .map(({ target, ...rest }) => (target === undefined ? rest : { ...rest, target })),
    fc.record({ kind: c('has' as const), select: tie('m'), span: c(span) }),
    fc.record({
      kind: c('comprehension' as const),
      macro: fc.constantFrom(...macros),
      range: tie('e'),
      variable: fc.constantFrom('i', 'x'),
      body: tie('e'),
      span: c(span),
    }),
    fc.record({
      kind: c('unary' as const),
      op: fc.constantFrom(...unaries),
      operand: tie('e'),
      span: c(span),
    }),
    fc.record({
      kind: c('binary' as const),
      op: fc.constantFrom(...binaries),
      left: tie('e'),
      right: tie('e'),
      span: c(span),
    }),
    fc.record({
      kind: c('conditional' as const),
      test: tie('e'),
      then: tie('e'),
      else: tie('e'),
      span: c(span),
    }),
    fc.record({ kind: c('list' as const), elements: fc.array(tie('e'), { maxLength: 3 }), span: c(span) }),
    fc.record({
      kind: c('map' as const),
      entries: fc.array(fc.record({ key: tie('e'), value: tie('e'), span: c(span) }), { maxLength: 3 }),
      span: c(span),
    }),
  ),
})).e;

describe('totality', () => {
  it('evaluate never throws on any AST, and is deterministic', () => {
    fc.assert(
      fc.property(expr, (ast) => {
        const typed = { ast, type: T.dyn, types: new Map() };
        const ctx = evalContext();
        const a = evaluate(typed, ctx);
        const b = evaluate(typed, ctx);
        expect(a).toEqual(b);
        expect(typeof a.ok).toBe('boolean');
        if (a.ok) JSON.stringify(a.value);
      }),
      { numRuns: 1500 },
    );
  });

  it('never throws on random source text that parses', () => {
    const tokens = [
      'self',
      '.',
      'stage',
      'hoehe',
      '(',
      ')',
      '[',
      ']',
      '1',
      '2.5',
      "'a'",
      '+',
      '-',
      '*',
      '/',
      '%',
      '&&',
      '||',
      '!',
      '==',
      '<',
      'in',
      '?',
      ':',
      ',',
      'null',
      'true',
      'now',
      'today()',
      'size(',
      'has(self.stage)',
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...tokens), { minLength: 1, maxLength: 14 }), (ts) => {
        const p = parse(ts.join(' '));
        if (!p.ok) return;
        const typed = { ast: p.ast, type: T.dyn, types: new Map() };
        expect(typeof evaluate(typed, evalContext()).ok).toBe('boolean');
      }),
      { numRuns: 1500 },
    );
  });
});
