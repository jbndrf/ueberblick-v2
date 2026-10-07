import { describe, expect, it } from 'vitest';
import { PARSE_LIMITS, type ParseLimits, type ParseResult } from '../ast';
import { ENV } from '../__fixtures__/check-cases';
import { fromCql2 } from '../cql2';
import { parse } from '../parse';
import { T, check } from '.';

/** Repeats `unit` until the source is as long as the limit allows. */
const fill = (maxLength: number, head: string, unit: string, tail = ''): string =>
  head + unit.repeat(Math.floor((maxLength - head.length - tail.length) / unit.length)) + tail;

type Shape = readonly [string, (maxLength: number) => string];

const RULE_SHAPES: readonly Shape[] = [
  ['binary ||', (n) => fill(n, 'a', '||a')],
  ['binary +', (n) => fill(n, '1', '+1')],
  ['binary mixed', (n) => fill(n, 'a', '&&a||a')],
  ['member', (n) => fill(n, 'self', '.a')],
  ['index', (n) => fill(n, 'self', '[0]')],
  ['call', (n) => fill(n, 'self', '.f()')],
  ['unary !', (n) => '!'.repeat(n - 1) + 'a'],
  ['unary -', (n) => '-'.repeat(n - 1) + 'a'],
  ['ternary', (n) => fill(n, '', 'a?a:', 'a')],
  ['nested parens', (n) => '('.repeat(Math.floor((n - 1) / 2)) + 'a' + ')'.repeat(Math.floor((n - 1) / 2))],
  ['nested lists', (n) => '['.repeat(Math.floor((n - 1) / 2)) + 'a' + ']'.repeat(Math.floor((n - 1) / 2))],
];

const CQL2_SHAPES: readonly Shape[] = [
  ['OR chain', (n) => fill(n, 'a=1', ' OR a=1')],
  ['NOT chain', (n) => fill(n, '', 'NOT ', 'a=1')],
  ['minus chain', (n) => fill(n, '', '- ', '1 = a')],
  ['nested parens', (n) => '('.repeat(Math.floor((n - 3) / 2)) + 'a=1' + ')'.repeat(Math.floor((n - 3) / 2))],
  ['arithmetic chain', (n) => fill(n, 'a=1', '+1')],
];

function expectTotal(r: ParseResult): void {
  if (!r.ok) {
    expect(r.errors.length).toBeGreaterThan(0);
    for (const e of r.errors) {
      expect(e.span.end).toBeGreaterThanOrEqual(e.span.start);
      expect(e.message.length).toBeGreaterThan(0);
    }
  }
}

describe.each(Object.entries(PARSE_LIMITS))(
  'max-size chain shapes under %s limits',
  (_, limits: ParseLimits) => {
    it.each(RULE_SHAPES)('%s: parse then check never throw', (_shape, make) => {
      const src = make(limits.maxLength);
      expect(src.length).toBeLessThanOrEqual(limits.maxLength);
      const r = parse(src, limits);
      expectTotal(r);
      if (!r.ok) return;
      const env = { ...ENV, vars: { ...ENV.vars, a: T.bool } };
      expect(() => check(r.ast, env)).not.toThrow();
    });

    it.each(CQL2_SHAPES)('CQL2 %s: fromCql2 never throws', (_shape, make) => {
      const src = make(limits.maxLength);
      expect(src.length).toBeLessThanOrEqual(limits.maxLength);
      expectTotal(fromCql2(src, { limits }));
    });

    it('postfix, unary and ternary nesting is rejected past maxDepth with a span', () => {
      const n = limits.maxDepth * 5 + 8;
      for (const src of [
        fill(n, 'self', '.a'),
        fill(n, 'self', '[0]'),
        fill(n, 'self', '.f()'),
        '!'.repeat(limits.maxDepth + 1) + 'a',
        fill(n, '', 'a?a:', 'a'),
      ]) {
        const r = parse(src, limits);
        expect(r.ok, src).toBe(false);
        if (!r.ok) expect(r.errors[0]?.message).toContain('nested deeper');
      }
    });
  },
);
