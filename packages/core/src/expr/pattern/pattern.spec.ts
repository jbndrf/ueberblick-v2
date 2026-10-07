import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MATCHES_LIMITS } from '../../registry';
import { cacheStats, matchesPattern, patternProblem } from '.';

describe('accepted subset', () => {
  const CASES: readonly (readonly [string, string, boolean])[] = [
    ['abc', 'b', true],
    ['abc', '^b', false],
    ['abc', 'c$', true],
    ['abc', '^abc$', true],
    ['abc', '^$', false],
    ['', '^$', true],
    ['', 'a*', true],
    ['aaa', '^a{2,3}$', true],
    ['aaaa', '^a{2,3}$', false],
    ['aaaa', '^a{2,}$', true],
    ['ab', '^a{1}b$', true],
    ['x', '^(a|b|x)$', true],
    ['abab', '^(?:ab)+$', true],
    ['abc', '[a-c]{3}', true],
    ['abd', '^[a-c]+$', false],
    ['abd', '^[^d]+$', false],
    ['a-b', '^[a\\-b]+$', true],
    ['a-b', '^[-ab]+$', true],
    ['a]b', '^[\\]ab]+$', true],
    ['12:30', '^\\d{2}:\\d{2}$', true],
    ['a b', '^\\w\\s\\w$', true],
    ['a.b', '^a\\.b$', true],
    ['axb', '^a\\.b$', false],
    ['a\nb', '^a.b$', false],
    ['😀', '^.$', true],
    ['😀', '^..$', false],
    ['(x)', '^\\(x\\)$', true],
    ['ab', '(a*)*b', true],
    ['', '(a*)*', true],
    ['a\nb', 'a\\nb', true],
  ];
  it.each(CASES)('%j matches %s -> %s', (text, pattern, expected) => {
    expect(patternProblem(pattern)).toBeUndefined();
    expect(matchesPattern(text, pattern)).toBe(expected);
  });
});

describe('refused patterns carry a typed problem', () => {
  const REFUSED: readonly (readonly [string, string, string, string | number])[] = [
    ['(a', 'matches_pattern_syntax', 'detail', 'unclosed_group'],
    ['a)', 'matches_pattern_syntax', 'detail', 'unmatched_paren'],
    ['[a', 'matches_pattern_syntax', 'detail', 'unclosed_class'],
    ['[]', 'matches_pattern_syntax', 'detail', 'empty_class'],
    ['[z-a]', 'matches_pattern_syntax', 'detail', 'bad_range'],
    ['[a-\\d]', 'matches_pattern_syntax', 'detail', 'bad_range'],
    ['a{2,1}', 'matches_pattern_syntax', 'detail', 'bad_repeat'],
    ['a{x}', 'matches_pattern_syntax', 'detail', 'bad_repeat'],
    ['a{', 'matches_pattern_syntax', 'detail', 'bad_repeat'],
    ['*a', 'matches_pattern_syntax', 'detail', 'nothing_to_repeat'],
    ['a**', 'matches_pattern_syntax', 'detail', 'nothing_to_repeat'],
    ['^*', 'matches_pattern_syntax', 'detail', 'nothing_to_repeat'],
    ['\\q', 'matches_pattern_syntax', 'detail', 'bad_escape'],
    ['a\\', 'matches_pattern_syntax', 'detail', 'trailing_backslash'],
    ['((((((((((a))))))))))', 'matches_pattern_syntax', 'detail', 'nested_too_deep'],
    ['(a)\\1', 'matches_pattern_unsupported', 'feature', 'backreference'],
    ['(?=a)', 'matches_pattern_unsupported', 'feature', 'lookaround'],
    ['(?!a)', 'matches_pattern_unsupported', 'feature', 'lookaround'],
    ['(?<=a)b', 'matches_pattern_unsupported', 'feature', 'lookaround'],
    ['(?<n>a)', 'matches_pattern_unsupported', 'feature', 'named_group'],
    ['(?P<n>a)', 'matches_pattern_unsupported', 'feature', 'named_group'],
    ['(?i)a', 'matches_pattern_unsupported', 'feature', 'group_flag'],
    ['a*?', 'matches_pattern_unsupported', 'feature', 'lazy_quantifier'],
    ['a{1,2}?', 'matches_pattern_unsupported', 'feature', 'lazy_quantifier'],
    ['a++', 'matches_pattern_unsupported', 'feature', 'possessive_quantifier'],
    ['\\bword', 'matches_pattern_unsupported', 'feature', 'word_boundary'],
    ['\\p{L}', 'matches_pattern_unsupported', 'feature', 'unicode_property'],
    ['[\\D]', 'matches_pattern_unsupported', 'feature', 'shorthand_in_class'],
    [
      'a'.repeat(MATCHES_LIMITS.patternLength + 1),
      'matches_pattern_too_long',
      'max',
      MATCHES_LIMITS.patternLength,
    ],
    ['a{51}', 'matches_pattern_too_big', 'max', MATCHES_LIMITS.states],
    ['((a{50}){50}){50}', 'matches_pattern_too_big', 'max', MATCHES_LIMITS.states],
    ['(a{50}){30}', 'matches_pattern_too_big', 'max', MATCHES_LIMITS.states],
  ];
  it.each(REFUSED)('%s -> %s', (pattern, code, param, value) => {
    const p = patternProblem(pattern);
    expect(p?.code).toBe(code);
    expect(p?.params[param]).toBe(value);
    expect(matchesPattern('a', pattern)).toBeUndefined();
  });
});

// Random patterns of the subset, built from fragments that JS RegExp (u flag) reads the same way.
const ALPHABET = ['a', 'b', 'c', '1', ' ', '-', '😀'];
const atom: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('a', 'b', 'c', '1', '.', '\\d', '\\w', '\\s', '\\D', '\\W', '\\S', '😀', '\\.', '-'),
  fc.constantFrom('[abc]', '[^a]', '[a-c1]', '[b-c]', '[^\\d]', '[\\w-]', '[a\\-]', '[😀a]'),
);
const quant = fc.constantFrom('', '', '', '*', '+', '?', '{2}', '{1,3}', '{0,2}', '{2,}');
const piece = fc.tuple(atom, quant).map(([a, q]) => a + q);
const branch = fc.array(piece, { minLength: 1, maxLength: 4 }).map((p) => p.join(''));
const pattern: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(
      fc.oneof(
        branch,
        branch.map((b) => `(${b})`),
        fc.tuple(branch, branch, quant).map(([x, y, q]) => `(?:${x}|${y})${q}`),
      ),
      { minLength: 1, maxLength: 3 },
    ),
    fc.boolean(),
    fc.boolean(),
  )
  .map(([parts, bol, eol]) => `${bol ? '^' : ''}${parts.join('')}${eol ? '$' : ''}`);
const text = fc.array(fc.constantFrom(...ALPHABET, '\n', 'é'), { maxLength: 12 }).map((c) => c.join(''));

describe('agrees with JS RegExp', () => {
  it('on random patterns of the subset and random strings', () => {
    fc.assert(
      fc.property(pattern, fc.array(text, { minLength: 3, maxLength: 6 }), (pat, texts) => {
        expect(patternProblem(pat), pat).toBeUndefined();
        const re = new RegExp(pat, 'u');
        for (const t of texts)
          expect(matchesPattern(t, pat), `${pat} on ${JSON.stringify(t)}`).toBe(re.test(t));
      }),
      { numRuns: 1500 },
    );
  });

  it('is total: any pattern text gives a result or a typed problem, never an exception', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 20 }), (pat, t) => {
        const r = matchesPattern(t, pat);
        expect(r === undefined ? patternProblem(pat) !== undefined : true).toBe(true);
        if (r !== undefined) {
          // whatever it accepts, JS agrees when JS accepts it too
          let re: RegExp | undefined;
          try {
            re = new RegExp(pat, 'u');
          } catch {
            re = undefined;
          }
          if (re) expect(r, `${JSON.stringify(pat)} on ${JSON.stringify(t)}`).toBe(re.test(t));
        }
      }),
      { numRuns: 3000 },
    );
  });
});

describe('the DFA cache is bounded and never changes a result', () => {
  it('a pattern whose DFA has thousands of states still agrees with RegExp', () => {
    const pat = '(a|b)*a(a|b){11}$';
    const re = new RegExp(pat, 'u');
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b'), { maxLength: 60 }), (cs) => {
        const t = cs.join('');
        expect(matchesPattern(t, pat), t).toBe(re.test(t));
      }),
      { numRuns: 800 },
    );
  });
});

describe('cache memory is capped (MATCHES_LIMITS)', () => {
  it('many distinct non-ASCII code points do not grow a program without limit', () => {
    const pat = '[a-z]*b';
    // 40,000 distinct code points from the CJK block, none of which is an ASCII letter
    const text = Array.from({ length: 40_000 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    expect(matchesPattern(text, pat)).toBe(false);
    expect(matchesPattern(`${text}b`, pat)).toBe(true);
    const s = cacheStats(pat);
    expect(s.transitions).toBeLessThanOrEqual(MATCHES_LIMITS.dfaTransitions);
    expect(s.states).toBeLessThanOrEqual(MATCHES_LIMITS.dfaStates);
    expect(matchesPattern('xxb', pat)).toBe(true);
  });

  it('states are capped, and results stay right once the cap is hit', () => {
    const pat = '(a|b)*a(a|b){11}$';
    const re = new RegExp(pat, 'u');
    for (let i = 0; i < 30; i++) {
      const t = Array.from({ length: 200 }, (_, k) =>
        (i * 7919 + k * k * 31 + (k >> 2)) % 5 < 3 ? 'a' : 'b',
      ).join('');
      expect(matchesPattern(t, pat)).toBe(re.test(t));
    }
    const s = cacheStats(pat);
    expect(s.states).toBeLessThanOrEqual(MATCHES_LIMITS.dfaStates);
    expect(s.transitions).toBeLessThanOrEqual(MATCHES_LIMITS.dfaTransitions);
  });

  it('the program cache evicts and never holds more than the limit', () => {
    for (let i = 0; i < MATCHES_LIMITS.programs * 3; i++) {
      expect(matchesPattern(`x${i}y`, `^x${i}y$`)).toBe(true);
      expect(cacheStats(`^x${i}y$`).programs).toBeLessThanOrEqual(MATCHES_LIMITS.programs);
    }
    // an evicted pattern is compiled again and still answers
    expect(matchesPattern('x0y', '^x0y$')).toBe(true);
  });
});

describe('adversarial patterns stay linear (timing: bench/expr-matches)', () => {
  it('(a*)*b, (a|a)*b and (a+)+$ on long inputs return', () => {
    const text = 'a'.repeat(10_000);
    expect(matchesPattern(text, '^(a*)*b$')).toBe(false);
    expect(matchesPattern(text, '^(a|a)*b$')).toBe(false);
    expect(matchesPattern(`${text}!`, '^(a+)+$')).toBe(false);
    expect(matchesPattern(text, '^(a+)+$')).toBe(true);
  });
});
