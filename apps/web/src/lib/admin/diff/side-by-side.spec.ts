// WP-1056: removed+added runs pair into changed rows; unchanged rows align across both sides.
import { describe, expect, it } from 'vitest';
import { collapse, lineDiff } from './line-diff';
import { pairRows } from './side-by-side';

const run = (a: string[], b: string[], expanded: ReadonlySet<number> = new Set()) => {
  const ops = lineDiff(a, b);
  return pairRows(collapse(ops, 3), ops, expanded);
};

describe('pairRows', () => {
  it('pairs a removed and an added line on one row', () => {
    const rows = run(['a', 'b', 'c'], ['a', 'x', 'c']);
    expect(rows.map((r) => r.kind)).toEqual(['equal', 'pair', 'equal']);
    const p = rows[1];
    expect(p?.kind === 'pair' && [p.left?.text, p.right?.text]).toEqual(['b', 'x']);
  });
  it('pairs the longer run with empty cells', () => {
    const rows = run(['a', 'b', 'c'], ['a', 'x']);
    const pairs = rows.filter((r) => r.kind === 'pair');
    expect(pairs).toHaveLength(2);
    expect(pairs[1]?.kind === 'pair' && pairs[1].right).toBeNull();
    const add = run(['a'], ['a', 'x', 'y']).filter((r) => r.kind === 'pair');
    expect(add.every((r) => r.kind === 'pair' && r.left === null && r.right !== null)).toBe(true);
  });
  it('folds and unfolds unchanged runs', () => {
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`);
    const b = many.map((l, i) => (i === 20 ? 'x' : l));
    const rows = run(many, b);
    const fold = rows.find((r) => r.kind === 'folded');
    expect(fold?.kind === 'folded' && fold.count).toBeGreaterThan(0);
    const open = run(many, b, new Set(rows.flatMap((r) => (r.kind === 'folded' ? [r.from] : []))));
    expect(open.some((r) => r.kind === 'folded')).toBe(false);
    expect(open).toHaveLength(40);
  });
  it('keeps every line: left lines are the old text, right the new', () => {
    const a = ['1', '2', '3', '4'];
    const b = ['1', 'x', '3', 'y', 'z'];
    const rows = run(a, b);
    const side = (pick: 'left' | 'right'): string[] =>
      rows.flatMap((r) => {
        if (r.kind === 'equal') return [r.line.text];
        if (r.kind === 'pair') return r[pick] ? [r[pick].text] : [];
        return [];
      });
    expect(side('left')).toEqual(a);
    expect(side('right')).toEqual(b);
  });
});
