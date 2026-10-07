// WP-438: "Nur eigene" is the conjunct `self.$created_by == actor.id` of a task's `when`.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OWN_CLAUSE, isOnlyOwn, ownEditable, withOwn, withoutOwn } from './conditions-own';
import { openProject, type Doc, type Op } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { ownOps, rowsOps } from './conditions-own';

describe('Nur eigene', () => {
  it('reads and writes the clause', () => {
    expect(isOnlyOwn(undefined)).toBe(false);
    expect(isOnlyOwn(OWN_CLAUSE)).toBe(true);
    expect(isOnlyOwn(`self.a > 1 && ${OWN_CLAUSE}`)).toBe(true);
    expect(isOnlyOwn('actor.id == self.$created_by')).toBe(true);
    expect(isOnlyOwn('self.a > 1')).toBe(false);
    expect(withOwn(undefined, true)).toBe(OWN_CLAUSE);
    expect(withOwn(OWN_CLAUSE, false)).toBeUndefined();
    expect(withOwn('self.a > 1', true)).toBe(`${OWN_CLAUSE} && self.a > 1`);
    expect(withOwn(`${OWN_CLAUSE} && self.a > 1`, false)).toBe('self.a > 1');
  });

  it('does not change the other rows', () => {
    const when = withOwn('self.y > 2 && self.x == 1', true) ?? '';
    expect(withoutOwn(when)).toBe('self.y > 2 && self.x == 1');
  });

  it('is idempotent and reversible (property)', () => {
    const base = fc.constantFrom(undefined, 'self.a > 1', 'self.c < 4', 'self.c < 4 && self.b == 2');
    fc.assert(
      fc.property(base, (src) => {
        const on = withOwn(src, true);
        expect(withOwn(on, true)).toBe(on);
        expect(isOnlyOwn(on)).toBe(true);
        expect(withOwn(on, false)).toBe(src);
      }),
    );
  });

  it('leaves a condition that does not parse alone, and groups an || next to the clause', () => {
    expect(ownEditable('((')).toBe(false);
    expect(withOwn('((', true)).toBe('((');
    expect(withOwn('self.a == 1 || self.b == 2', true)).toBe(`${OWN_CLAUSE} && (self.a == 1 || self.b == 2)`);
    expect(withOwn(`${OWN_CLAUSE} && (self.a == 1 || self.b == 2)`, false)).toBe(
      'self.a == 1 || self.b == 2',
    );
    expect(isOnlyOwn('self.a == 1 || self.$created_by == actor.id')).toBe(false);
  });
});

describe('on a task of the file', () => {
  const apply = (doc: Doc, ops: readonly Op[]): Doc =>
    ops.reduce((d, op) => {
      const r = d.apply(op);
      expect(r.refused).toBeUndefined();
      return r.doc;
    }, doc);
  const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
  const when = (d: Doc): string | undefined => d.effective().tasks?.['kontrolle']?.when;

  it('switches on and off, and the rows keep it', () => {
    let doc = apply(open(), ownOps(open(), 'kontrolle', true));
    expect(when(doc)).toContain(OWN_CLAUSE);
    doc = apply(doc, rowsOps(doc, 'kontrolle', 'self.hoehe_m > 3'));
    expect(isOnlyOwn(when(doc))).toBe(true);
    expect(withoutOwn(when(doc))).toBe('self.hoehe_m > 3');
    doc = apply(doc, ownOps(doc, 'kontrolle', false));
    expect(isOnlyOwn(when(doc))).toBe(false);
    expect(when(doc)).toBe('self.hoehe_m > 3');
    expect(doc.problems()).toEqual(open().problems());
  });
});
