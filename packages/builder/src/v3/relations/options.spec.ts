// WP-371: the relation options as visible config. Pure helpers: operands of a `when`, step shapes.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  blockTerm,
  cascadeStep,
  conjuncts,
  detachStep,
  hasBlock,
  isOptionStep,
  withBlock,
  withoutBlock,
  type RelationRef,
} from './options';

const REL: RelationRef = {
  parent: 'eltern',
  key: 'kinder',
  child: 'kind',
  refKey: 'eltern',
  cardinality: 'many',
};
const OTHER: RelationRef = { ...REL, key: 'gutachten', child: 'gutachten' };

describe('conjuncts', () => {
  it('splits on top-level && only', () => {
    expect(conjuncts("a && (b && c) && 'x && y' == z")).toEqual(['a', '(b && c)', "'x && y' == z"]);
  });
  it('an expression with a top-level || or ?: is one operand', () => {
    expect(conjuncts('a || b && c')).toEqual(['a || b && c']);
    expect(conjuncts('a ? b : c')).toEqual(['a ? b : c']);
    expect(conjuncts('(a || b) && c')).toEqual(['(a || b)', 'c']);
  });
});

describe('the blocking operand of a when', () => {
  it('is added to an existing condition and found again', () => {
    const when = withBlock("'boss' in actor.roles", REL);
    expect(when).toBe("'boss' in actor.roles && self.kinder.size() == 0");
    expect(hasBlock(when, REL)).toBe(true);
    expect(hasBlock(when, OTHER)).toBe(false);
  });
  it('a condition with || is wrapped, so the operand does not change its meaning', () => {
    expect(withBlock('a || b', REL)).toBe('(a || b) && self.kinder.size() == 0');
    expect(withoutBlock('(a || b) && self.kinder.size() == 0', REL)).toBe('(a || b)');
  });
  it('a one relation reads as a feature', () => {
    expect(blockTerm({ key: 'k', cardinality: 'one' })).toBe('self.k == null');
  });
  it('removing the operand leaves the rest, and nothing when nothing is left', () => {
    expect(withoutBlock('self.kinder.size() == 0', REL)).toBeUndefined();
    expect(withoutBlock(undefined, REL)).toBeUndefined();
    expect(withoutBlock('x && self.kinder.size() == 0 && self.gutachten.size() == 0', REL)).toBe(
      'x && self.gutachten.size() == 0',
    );
  });
  it('adding twice, or after removing, gives one operand (property)', () => {
    const operands = fc.constantFrom('a', 'b == 1', "'r' in actor.roles", 'x > 2');
    fc.assert(
      fc.property(
        fc.option(fc.array(operands, { minLength: 1, maxLength: 3 }), { nil: undefined }),
        (list) => {
          const src = list?.join(' && ');
          const once = withBlock(src, REL);
          expect(withBlock(once, REL)).toBe(once);
          expect(conjuncts(once).filter((p) => p === blockTerm(REL))).toHaveLength(1);
          expect(withoutBlock(once, REL)).toBe(src);
        },
      ),
    );
  });
});

describe('the generated steps', () => {
  it('are recognised by their shape and relation, not by position', () => {
    expect(isOptionStep(cascadeStep(REL), REL)).toBe(true);
    expect(isOptionStep(detachStep(REL), REL)).toBe(true);
    expect(isOptionStep(cascadeStep(REL), OTHER)).toBe(false);
    expect(isOptionStep({ lifecycle: 'deleted' }, REL)).toBe(false);
    expect(isOptionStep({ set: { name: "'x'" }, of: 'self.kinder' }, REL)).toBe(false);
  });
});
