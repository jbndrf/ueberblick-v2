// WP-506: the line diff of two project files. Applying the diff to the old lines gives the new ones (property test).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyDiff, collapse, lineDiff, splitLines, DIFF_OP } from './line-diff';

const lines = (s: string): string[] => s.split('');

/** Reference: the length of the longest common subsequence (memoised recursion, small inputs). */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const memo = new Map<string, number>();
  const go = (i: number, j: number): number => {
    if (i === a.length || j === b.length) return 0;
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = a[i] === b[j] ? 1 + go(i + 1, j + 1) : Math.max(go(i + 1, j), go(i, j + 1));
    memo.set(key, v);
    return v;
  };
  return go(0, 0);
}

describe('lineDiff', () => {
  it('equal inputs: only equal lines', () => {
    expect(lineDiff(lines('abc'), lines('abc')).every((o) => o.op === DIFF_OP.equal)).toBe(true);
  });

  it('never published: everything is added', () => {
    const ops = lineDiff([], lines('ab'));
    expect(ops).toEqual([
      { op: DIFF_OP.add, text: 'a', oldLine: null, newLine: 1 },
      { op: DIFF_OP.add, text: 'b', oldLine: null, newLine: 2 },
    ]);
  });

  it('a changed line is a removal and an addition with both line numbers', () => {
    const ops = lineDiff(['x', 'a', 'z'], ['x', 'b', 'z']);
    expect(ops.map((o) => o.op)).toEqual([DIFF_OP.equal, DIFF_OP.remove, DIFF_OP.add, DIFF_OP.equal]);
    expect(ops[1]).toMatchObject({ oldLine: 2, newLine: null });
    expect(ops[2]).toMatchObject({ oldLine: null, newLine: 2 });
  });

  it('property: applying the diff to the old lines yields the new lines', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 40 }),
        fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 40 }),
        (a, b) => {
          expect(applyDiff(a, lineDiff(a, b))).toEqual(b);
        },
      ),
    );
  });

  it('property: the equal lines are a common subsequence of both and the diff is minimal in size', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 25 }),
        fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 25 }),
        (a, b) => {
          const ops = lineDiff(a, b);
          const kept = ops.filter((o) => o.op === DIFF_OP.equal).length;
          expect(kept).toBe(lcsLength(a, b));
        },
      ),
    );
  });
});

describe('collapse', () => {
  it('keeps the context around a change and folds the long unchanged runs', () => {
    const old = Array.from({ length: 100 }, (_, i) => `l${i}`);
    const next = [...old];
    next[50] = 'changed';
    const rows = collapse(lineDiff(old, next), 3);
    const folded = rows.filter((r) => r.kind === 'folded');
    expect(folded.map((f) => (f.kind === 'folded' ? f.count : 0))).toEqual([47, 46]);
    const shown = rows.filter((r) => r.kind === 'line');
    expect(shown).toHaveLength(3 + 2 + 3);
  });

  it('no change: one folded run for the whole file, none for an empty file', () => {
    expect(collapse(lineDiff(['a', 'b'], ['a', 'b']), 3)).toEqual([{ kind: 'folded', count: 2, from: 0 }]);
    expect(collapse([], 3)).toEqual([]);
  });

  it('a short run between two changes stays open', () => {
    const rows = collapse(lineDiff(['a', 'x', 'b', 'c', 'y', 'd'], ['a', 'X', 'b', 'c', 'Y', 'd']), 3);
    expect(rows.some((r) => r.kind === 'folded')).toBe(false);
  });
});

describe('splitLines', () => {
  it('drops the final newline and keeps empty lines', () => {
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('large files', () => {
  it('a 5000-line file with a few edits diffs fast (bench in the log: ~ms, no wall-clock assertion)', () => {
    const old = Array.from({ length: 5000 }, (_, i) => `key_${i}: value ${i}`);
    const next = old.filter((_, i) => i % 700 !== 0).map((l, i) => (i % 900 === 5 ? `${l} !` : l));
    const ops = lineDiff(old, next);
    expect(applyDiff(old, ops)).toEqual(next);
    expect(collapse(ops, 3).length).toBeLessThan(200);
  });
});
