import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENV,
  EVAL_ABSORB,
  EVAL_DYN_ERR,
  EVAL_ERR,
  EVAL_NULL,
  EVAL_OK,
  NOW,
  evalContext,
} from '../__fixtures__/eval-cases';
import type { TypedAst } from '../check';
import { BUILTIN_FUNCTIONS, check } from '../check';
import type { EvalContext, EvalResult } from '../contract';
import { FUNCTION_LIST, FUNCTIONS, functionSignatures } from '../functions';
import { parse } from '../parse';
import { MAX_ITERATIONS, condition, evaluate, evaluateApi } from '.';

function typedOf(src: string, expect_?: Parameters<typeof check>[2]): TypedAst {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse ${src}: ${p.errors[0]?.message ?? '?'}`);
  const c = check(p.ast, ENV, expect_);
  if (!c.ok) throw new Error(`check ${src}: ${c.errors.map((e) => e.message).join('; ')}`);
  return c.typed;
}

const run = (src: string, ctx: EvalContext = evalContext()): EvalResult => evaluate(typedOf(src), ctx);
const value = (src: string, ctx?: EvalContext) => {
  const r = run(src, ctx);
  if (!r.ok) throw new Error(`${src}: ${r.error.message}`);
  return r.value;
};

afterEach(() => vi.restoreAllMocks());

describe('evaluate: corpus', () => {
  it.each(EVAL_OK)('%s', (src, expected) => {
    expect(value(src)).toEqual(expected);
  });
});

describe('evaluate: null semantics', () => {
  it.each(EVAL_NULL)('%s is null', (src) => {
    expect(value(src)).toBeNull();
  });

  it('null == null and null != 1 are plain booleans', () => {
    expect(value('null == null')).toBe(true);
    expect(value('null != 1')).toBe(true);
  });

  it.each(EVAL_ABSORB)('%s', (src, expected) => {
    expect(value(src)).toBe(expected);
  });

  it('a missing value is null and never an error; has() tests presence', () => {
    expect(value('has(self.notiz)')).toBe(false);
    expect(value('self.notiz')).toBeNull();
  });

  it('three-valued logic: true && null is null, false || null is null', () => {
    expect(value('true && self.meta.gone')).toBeNull();
    expect(value('false || self.meta.gone')).toBeNull();
  });

  it('macros: null elements make exists/all unknown unless decided', () => {
    const ctx = evalContext({ xs: [true, null] });
    expect(evaluate(typedWith('xs.exists(x, x)'), ctx)).toEqual({ ok: true, value: true });
    expect(evaluate(typedWith('xs.all(x, x)'), ctx)).toEqual({ ok: true, value: null });
  });
});

function typedWith(src: string): TypedAst {
  const p = parse(src);
  if (!p.ok) throw new Error('parse');
  const c = check(p.ast, { ...ENV, vars: { ...ENV.vars, xs: { kind: 'list', element: { kind: 'dyn' } } } });
  if (!c.ok) throw new Error(c.errors.map((e) => e.message).join('; '));
  return c.typed;
}

describe('evaluate: errors are results, never throws', () => {
  it.each(EVAL_ERR)('%s -> %s', (src, fragment) => {
    const r = run(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain(fragment);
    expect(r.error.span.end).toBeGreaterThan(r.error.span.start);
  });

  it.each(EVAL_DYN_ERR)('%s -> %s', (src, fragment) => {
    const r = run(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain(fragment);
  });

  it('the error span points at the failing operation', () => {
    const src = "self.stage == 'x' || 10 / (1 - 1) > 0";
    const r = run(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(src.slice(r.error.span.start, r.error.span.end)).toBe('10 / (1 - 1)');
  });

  it('an unknown name at run time is an error result', () => {
    const r = evaluate(typedOf('form.hoehe'), { ...evalContext(), vars: new Map() });
    expect(r.ok).toBe(false);
  });
});

describe('condition: an error or a non-bool counts as false and is reported', () => {
  it('true and false pass through without error', () => {
    expect(condition(typedOf("self.stage == 'aktiv'"), evalContext())).toEqual({ value: true });
    expect(condition(typedOf("self.stage == 'x'"), evalContext())).toEqual({ value: false });
  });

  it('an error in `when` is false plus the error', () => {
    const c = condition(typedOf('1 / 0 == 1', { expect: { kind: 'bool' } }), evalContext());
    expect(c.value).toBe(false);
    expect(c.error?.message).toContain('division by zero');
  });

  it('an error in `relevant` is false plus the error', () => {
    const c = condition(typedOf("self.tags[9] == 'a'"), evalContext());
    expect(c.value).toBe(false);
    expect(c.error?.message).toContain('out of range');
  });

  it('null is false without an error (a missing value)', () => {
    expect(
      condition(typedOf('self.meta.gone == true && self.meta.gone'), evalContext()).error,
    ).toBeUndefined();
    const c = condition(typedOf('self.meta.gone'), evalContext());
    expect(c).toEqual({ value: false });
  });

  it('a non-bool result is false plus an error', () => {
    const c = condition(typedOf('self.hoehe'), evalContext());
    expect(c.value).toBe(false);
    expect(c.error?.message).toContain('true or false');
  });

  it('is exposed through EvaluateApi', () => {
    expect(evaluateApi.condition).toBe(condition);
    expect(evaluateApi.evaluate).toBe(evaluate);
  });
});

describe('evaluate: deterministic, no clock, no random', () => {
  it('reads time only from ctx.now', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock read');
    });
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('random read');
    });
    for (const [src] of EVAL_OK) expect(run(src).ok, src).toBe(true);
  });

  it('today() and now follow the injected time', () => {
    const later = { ...evalContext(), now: '2027-01-15T08:00:00.000Z' };
    expect(value('today()', later)).toBe('2027-01-15T00:00:00.000Z');
    expect(value('now', later)).toBe('2027-01-15T08:00:00.000Z');
    expect(value('now', evalContext())).toBe(NOW);
  });

  it('the same typed AST evaluates against different contexts (no context is cached)', () => {
    const t = typedOf('form.hoehe * 2');
    const a = evaluate(t, evalContext({ form: { hoehe: 1, art: 'a', anzahl: 1 } }));
    const b = evaluate(t, evalContext({ form: { hoehe: 5, art: 'a', anzahl: 1 } }));
    expect(a).toEqual({ ok: true, value: 2 });
    expect(b).toEqual({ ok: true, value: 10 });
  });

  it('two runs give identical results', () => {
    for (const [src] of EVAL_OK) expect(run(src)).toEqual(run(src));
  });
});

describe('evaluate: safe for untrusted ASTs (H4)', () => {
  it('a deeply nested AST is an error result, not a stack overflow', () => {
    const src = `${'-'.repeat(1)}1`;
    const t = typedOf(src);
    let ast = t.ast;
    for (let i = 0; i < 20_000; i++)
      ast = { kind: 'unary', op: '-', operand: ast, span: { start: 0, end: 1 } };
    const r = evaluate({ ast, type: t.type, types: new Map() }, evalContext());
    expect(r.ok).toBe(false);
  });

  it('nested comprehensions stop at the iteration budget', () => {
    const list = `[${Array.from({ length: 100 }, (_, i) => i).join(', ')}]`;
    const src = `${list}.map(a, ${list}.map(b, ${list}.map(c, c)))`;
    const r = run(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('too expensive');
    expect(MAX_ITERATIONS).toBeLessThan(1_010_100);
  });

  it('a map literal cannot forge a feature reference', () => {
    const r = run("{'$feature': 'b2'}.x");
    expect(r.ok).toBe(false);
  });

  it('an unknown function in a hand-built AST is an error result', () => {
    const span = { start: 0, end: 1 };
    const r = evaluate(
      { ast: { kind: 'call', name: 'shell', args: [], span }, type: { kind: 'dyn' }, types: new Map() },
      evalContext(),
    );
    expect(r).toEqual({ ok: false, error: { message: "unknown function 'shell'", span } });
  });
});

describe('function registry', () => {
  it('check derives its signatures from the registry (no second table)', () => {
    expect(Object.keys(BUILTIN_FUNCTIONS).sort()).toEqual(Object.keys(functionSignatures()).sort());
    for (const f of FUNCTION_LIST) if (f.sigs.length > 0) expect(BUILTIN_FUNCTIONS[f.name]).toBe(f.sigs);
  });

  it('every function of docs/06 is registered', () => {
    for (const name of [
      'intersects',
      'within',
      'contains',
      'touches',
      'disjoint',
      'dwithin',
      'distance',
      'area',
      'length',
      'today',
      'days',
      'months',
      'date',
      'days_between',
      'last',
      'changed',
      'count',
      'previous',
      'startsWith',
      'endsWith',
      'lower',
      'upper',
      'size',
    ])
      expect(FUNCTIONS.has(name), name).toBe(true);
  });

  it('spatial predicates have no SQL encoding (core.geo decides, after an R*Tree prefilter)', () => {
    for (const f of FUNCTION_LIST.filter((g) =>
      ['intersects', 'within', 'touches', 'disjoint'].includes(g.name),
    ))
      expect(f.sql, f.name).toBeUndefined();
  });

  it('check types a GeoJSON-shaped map literal as geometry; other maps stay maps', () => {
    const type = (src: string) => {
      const p = parse(src);
      if (!p.ok) throw new Error('parse');
      const c = check(p.ast, ENV);
      return c.ok ? c.typed.type.kind : 'error';
    };
    expect(type("{'type': 'Point', 'coordinates': [1.0, 2.0]}")).toBe('geometry');
    expect(type("{'coordinates': [[1.0, 2.0]], 'type': 'LineString'}")).toBe('geometry');
    expect(type("{'type': 'GeometryCollection', 'geometries': []}")).toBe('geometry');
    expect(type("{'type': 'Kreis', 'coordinates': []}")).toBe('map');
    expect(type("{'type': 'Point'}")).toBe('map');
    expect(type('within(1, area.geom)')).toBe('error');
    expect(type("within({'a': 1}, area.geom)")).toBe('error');
  });
});
