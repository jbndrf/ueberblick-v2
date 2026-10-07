import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { constraintOf, parseConstraint, patternProblem, type Rules } from './constraint';

describe('the constraint the field panel writes', () => {
  it('writes length, count and "must change" as one expression, and nothing for no rules', () => {
    expect(constraintOf({}, 'self.a')).toBeUndefined();
    expect(constraintOf({ minLength: 3 }, undefined)).toBe('size(value) >= 3');
    expect(constraintOf({ minLength: 3, maxLength: 9 }, undefined)).toBe(
      'size(value) >= 3 && size(value) <= 9',
    );
    expect(constraintOf({ change: true }, 'self.befund')).toBe('value != self.befund');
    expect(constraintOf({ change: true }, 'today() + months(1)')).toBe('value != (today() + months(1))');
    expect(constraintOf({ change: true }, undefined)).toBeUndefined();
  });

  it('reads the hand-written constraint of the golden project as the same rule', () => {
    expect(parseConstraint('value != self.befund', 'self.befund')).toEqual({
      foreign: false,
      rules: { change: true },
    });
  });

  it('a constraint of other shape is foreign', () => {
    expect(parseConstraint('value > 0 && value < 60', undefined)).toEqual({ foreign: true });
    expect(parseConstraint('value != self.befund', undefined)).toEqual({ foreign: true });
    expect(parseConstraint('size(value) >= 2 && size(value) >= 3', undefined)).toEqual({ foreign: true });
  });

  it('writes a pattern as matches() and a step as multiple_of, in a fixed order with the other rules', () => {
    expect(constraintOf({ pattern: '^[a-z]+$' }, undefined)).toBe("matches(value, '^[a-z]+$')");
    expect(constraintOf({ step: 5 }, undefined)).toBe('multiple_of(value, 5)');
    expect(constraintOf({ step: 0.25 }, undefined)).toBe('multiple_of(value, 0.25)');
    expect(
      constraintOf({ minLength: 2, maxLength: 9, pattern: '^\\d+$', step: 3, change: true }, 'self.a'),
    ).toBe(
      "size(value) >= 2 && size(value) <= 9 && matches(value, '^\\\\d+$') && multiple_of(value, 3) && value != self.a",
    );
    expect(constraintOf({ pattern: "it's" }, undefined)).toBe("matches(value, 'it\\'s')");
  });

  it('reads a pattern and a step back; a part that is anything else keeps the constraint foreign', () => {
    expect(parseConstraint("matches(value, '^a$') && multiple_of(value, 2)", undefined)).toEqual({
      foreign: false,
      rules: { pattern: '^a$', step: 2 },
    });
    expect(parseConstraint('multiple_of(value, 0.5)', undefined)).toEqual({
      foreign: false,
      rules: { step: 0.5 },
    });
    expect(parseConstraint('multiple_of(value, 0)', undefined)).toEqual({ foreign: true });
    expect(parseConstraint('multiple_of(value, 0.0000000001)', undefined)).toEqual({ foreign: true });
    expect(parseConstraint('value % 2 == 0', undefined)).toEqual({ foreign: true });
    expect(parseConstraint("matches(value, 'a') && matches(value, 'b')", undefined)).toEqual({
      foreign: true,
    });
    expect(parseConstraint("matches(self.x, 'a')", undefined)).toEqual({ foreign: true });
    expect(parseConstraint("matches(value, 'a\\d')", undefined)).toEqual({ foreign: true });
    expect(parseConstraint("matches(value, 'a') && value > 1", undefined)).toEqual({ foreign: true });
  });

  it('a pattern outside the matches subset is a problem with its code; a valid one is none', () => {
    expect(patternProblem('^[a-zA-Z]+$')).toBeUndefined();
    expect(patternProblem("it's \\d+")).toBeUndefined();
    expect(patternProblem('(?=a)b')?.code).toBe('matches_pattern_unsupported');
    expect(patternProblem('(a')?.code).toBe('matches_pattern_syntax');
    expect(patternProblem('a'.repeat(201))?.code).toBe('matches_pattern_too_long');
    expect(patternProblem('a\nb')).toBeUndefined();
  });

  it('property: any valid pattern and any step survive the round trip', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme-ascii', maxLength: 30 }),
        fc.integer({ min: 1, max: 100000 }),
        (pattern, step) => {
          const rules: Rules = { pattern, step };
          expect(parseConstraint(constraintOf(rules, undefined), undefined)).toEqual({
            foreign: false,
            rules,
          });
        },
      ),
    );
  });

  it('property: reading back what was written gives the rules, whatever the prefill', () => {
    const rules = fc.record(
      {
        minLength: fc.integer({ min: 0, max: 99 }),
        maxLength: fc.integer({ min: 0, max: 99 }),
        pattern: fc.string({ unit: 'grapheme-ascii', maxLength: 20 }),
        step: fc.oneof(
          fc.integer({ min: 1, max: 999 }),
          fc
            .tuple(fc.integer({ min: 1, max: 99999 }), fc.integer({ min: 1, max: 6 }))
            .map(([m, p]) => m / 10 ** p),
        ),
        change: fc.constant(true),
      },
      { requiredKeys: [] },
    );
    const calc = fc.constantFrom('self.a', "'x && y'", '1 + 2', 'self.a == 1 && self.b == 2', '(1)', 'now');
    fc.assert(
      fc.property(rules, calc, (r: Rules, c) => {
        const source = constraintOf(r, c);
        expect(parseConstraint(source, c)).toEqual({ foreign: false, rules: r });
      }),
    );
  });
});
