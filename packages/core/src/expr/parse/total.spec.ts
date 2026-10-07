import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARSE_LIMITS, type ParseLimits } from '../ast';
import { parse } from '.';

describe('parse is total', () => {
  it('never throws on 10k arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        const r = parse(s);
        expect(typeof r.ok).toBe('boolean');
      }),
      { numRuns: 10_000 },
    );
  });

  it('turns an internal exception into an error covering the whole input', () => {
    const boom: ParseLimits = {
      ...PARSE_LIMITS.config,
      get maxDepth(): number {
        throw new Error('boom');
      },
    };
    const src = 'a + b';
    const r = parse(src, boom);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        {
          code: 'parser_internal',
          message: 'internal parser error',
          params: {},
          span: { start: 0, end: src.length },
        },
      ]);
    }
  });

  it('also guards the length check', () => {
    const boom: ParseLimits = {
      ...PARSE_LIMITS.config,
      get maxLength(): number {
        throw new Error('boom');
      },
    };
    const r = parse('x', boom);
    expect(r.ok).toBe(false);
  });
});
