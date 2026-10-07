/** `multiple_of(value, step)`: an exact decimal step check (WP-457, docs/06 "multiple_of"). */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { T, check } from '../check';
import { evalContext } from '../__fixtures__/eval-cases';
import { evaluate } from '../evaluate';
import { parse } from '../parse';
import { isMultipleOf } from './numbers';

function run(src: string, vars: Record<string, number | null> = {}) {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse ${src}`);
  const c = check(p.ast, { vars: { v: T.double, s: T.double }, features: {} });
  if (!c.ok) throw new Error(`check ${src}`);
  return evaluate(c.typed, { ...evalContext(), vars: new Map(Object.entries(vars)) });
}

describe('multiple_of', () => {
  it('is exact for decimals binary floats get wrong', () => {
    expect(isMultipleOf(0.3, 0.1)).toBe(true);
    expect(isMultipleOf(0.7, 0.1)).toBe(true);
    expect(isMultipleOf(2.5, 0.5)).toBe(true);
    expect(isMultipleOf(2.7, 0.5)).toBe(false);
    expect(isMultipleOf(0.35, 0.1)).toBe(false);
    expect(isMultipleOf(10, 5)).toBe(true);
    expect(isMultipleOf(-0.06, 0.02)).toBe(true);
  });

  it('property: n times a step with at most 6 places is a multiple of it', () => {
    const step = fc
      .integer({ min: 1, max: 999999 })
      .chain((m) => fc.integer({ min: 0, max: 6 }).map((p) => m / 10 ** p));
    fc.assert(
      fc.property(step, fc.integer({ min: -500, max: 500 }), (s, n) => {
        expect(isMultipleOf(Number((n * s).toFixed(6)), s)).toBe(true);
      }),
    );
  });

  it('evaluates through the rule language; null in gives null; step 0 is an error', () => {
    expect(run('multiple_of(v, 0.1)', { v: 0.3 })).toEqual({ ok: true, value: true });
    expect(run('multiple_of(v, s)', { v: null, s: 0.5 })).toEqual({ ok: true, value: null });
    expect(run('multiple_of(v, s)', { v: 1, s: null })).toEqual({ ok: true, value: null });
    expect(run('multiple_of(v, 0)', { v: 1 }).ok).toBe(false);
    expect(run('multiple_of(v, -1)', { v: 1 }).ok).toBe(false);
    expect(run('multiple_of(v, 0.0000000001)', { v: 1 }).ok).toBe(false);
  });
});
