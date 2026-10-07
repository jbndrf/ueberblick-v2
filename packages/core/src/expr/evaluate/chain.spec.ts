import { describe, expect, it } from 'vitest';
import { evalContext } from '../__fixtures__/eval-cases';
import type { Expr } from '../ast';
import type { TypedAst } from '../check';
import { parse } from '../parse';
import { evaluate } from '.';

/** Long flat operator chains (A-005) must not recurse once per link. */
const span = { start: 0, end: 1 };
const int = (value: number): Expr => ({ kind: 'literal', type: 'int', value, span });
const bool = (value: boolean): Expr => ({ kind: 'literal', type: 'bool', value, span });
const bin = (op: '||' | '&&' | '+' | '==' | '/', left: Expr, right: Expr): Expr => ({
  kind: 'binary',
  op,
  left,
  right,
  span,
});
const chain = (op: '||' | '&&' | '+', first: Expr, next: (i: number) => Expr, n: number): Expr => {
  let e = first;
  for (let i = 0; i < n; i++) e = bin(op, e, next(i));
  return e;
};
const N = 20_000;
const typed = (ast: Expr): TypedAst => ({ ast, type: { kind: 'dyn' }, types: new Map() });
const run = (ast: Expr) => evaluate(typed(ast), evalContext());

describe('evaluate: long flat operator chains', () => {
  it('a max-size || chain', () => {
    expect(run(chain('||', bool(false), (i) => bool(i === N - 1), N))).toEqual({ ok: true, value: true });
    expect(run(chain('||', bool(false), () => bool(false), N))).toEqual({ ok: true, value: false });
  });

  it('a max-size && chain', () => {
    expect(run(chain('&&', bool(true), () => bool(true), N))).toEqual({ ok: true, value: true });
    expect(run(chain('&&', bool(true), (i) => bool(i !== 5), N))).toEqual({ ok: true, value: false });
  });

  it('a max-size + chain', () => {
    expect(run(chain('+', int(0), () => int(1), N))).toEqual({ ok: true, value: N });
  });

  it('an error inside a long || chain is absorbed by a later true, and reported otherwise', () => {
    const boom = bin('==', bin('/', int(1), int(0)), int(1));
    expect(run(chain('||', boom, (i) => bool(i === 10), N))).toEqual({ ok: true, value: true });
    const r = run(chain('||', boom, () => bool(false), N));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('division by zero');
  });

  it('a parsed chain evaluates like its parts', () => {
    const or = Array.from({ length: 1000 }, (_, i) => `self.alter == ${i}`).join(' || ');
    const sum = Array.from({ length: 1000 }, () => '1').join(' + ');
    for (const [src, expected] of [
      [or, true],
      [sum, 1000],
    ] as const) {
      const p = parse(src, { maxLength: 100_000, maxDepth: 64 });
      if (!p.ok) throw new Error(p.errors[0]?.message);
      expect(run(p.ast)).toEqual({ ok: true, value: expected });
    }
  });
});
