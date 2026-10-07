import { describe, expect, it } from 'vitest';
import { EXPR_ERRORS } from '../../registry/expr-errors';
import { ENV } from '../../expr/__fixtures__/check-cases';
import { check, T } from '../../expr/check';
import { parse } from '../../expr/parse';
import { Sink } from './problems';
import { reportParseErrors, reportTypeErrors } from './expr-problems';

/** The problems compile reports for one expression, parse first, then check as bool. */
function report(source: string): Sink {
  const sink = new Sink();
  const p = parse(source);
  if (!p.ok) reportParseErrors(sink, 'tasks.a.when', source, p.errors);
  else {
    const r = check(p.ast, ENV, { expect: T.bool });
    if (!r.ok) reportTypeErrors(sink, 'tasks.a.when', source, r.errors, 'fallback');
  }
  return sink;
}

describe('expression problems carry the error code and its params (WP-421)', () => {
  it('a parse error: expr_code, its params, the source and the position; no English detail', () => {
    const [p] = report('(1 2').problems;
    expect(p).toMatchObject({
      code: 'expression_parse',
      params: {
        expr_code: 'expected_punct',
        expected: ')',
        found_kind: 'number',
        source: '(1 2',
        position: 3,
      },
    });
    expect(p?.params).not.toHaveProperty('detail');
    expect(p?.message).toBe("expected ')' to close the parenthesis but found a number");
  });

  it('a type error: expr_code, the types, and the hint variant when the checker gave a hint', () => {
    const [p] = report('selff.stage').problems;
    expect(p).toMatchObject({
      code: 'expression_type',
      params: { expr_code: 'unknown_name', name: 'selff', near: 'self', hint_variant: 'near' },
      hint: "did you mean 'self'?",
    });
    expect(p?.params).not.toHaveProperty('detail');
    expect(p?.params).not.toHaveProperty('detail_hint');
  });

  it('a type error without a hint uses the fallback hint and has no hint variant', () => {
    const [p] = report('1 + 1').problems;
    expect(p).toMatchObject({
      params: { expr_code: 'result_type', expected: 'bool', actual: 'int' },
      hint: 'fallback',
    });
    expect(p?.params).not.toHaveProperty('hint_variant');
  });

  it('every reported code is in the registry', () => {
    for (const source of ['(', 'self.x', '1 + 1', "'a' > 1", 'foo(1)']) {
      for (const p of report(source).problems) {
        expect(EXPR_ERRORS.has(String(p.params?.['expr_code']))).toBe(true);
      }
    }
  });
});
