import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildFormModel } from '@ueberblick/ui';
import {
  deletePage,
  joinPageAt,
  keysOf,
  layoutOf,
  place,
  remove,
  rowsOf,
  setColumn,
  setPageMeta,
  startPageAt,
  step,
  type Column,
  type Dest,
  type Layout,
  type Placed,
} from './layout';

const k = (n: number): string => `k${n}`;
const shape = (l: Layout): unknown =>
  l.pages.map((p) => ({
    meta: p.meta,
    lines: p.lines.map((line) => line.map((c) => `${c.key}:${c.column}`)),
  }));

describe('layoutOf', () => {
  it('groups pages at the field that carries `page` and lines at neighbours with one row', () => {
    const l = layoutOf([
      { key: 'a' },
      { key: 'b', column: 'left', row: 1 },
      { key: 'c', column: 'right', row: 1 },
      { key: 'd', page: { label: { de: 'Zwei' } } },
      { key: 'e', column: 'left', row: 1 },
    ]);
    expect(shape(l)).toEqual([
      { meta: undefined, lines: [['a:full'], ['b:left', 'c:right']] },
      { meta: { label: { de: 'Zwei' } }, lines: [['d:full'], ['e:left']] },
    ]);
  });

  it('sees the form as the participant does: the same pages as the renderer model', () => {
    const entries: Placed[] = [
      { key: 'a', column: 'left', row: 1 },
      { key: 'b', column: 'right', row: 1 },
      { key: 'c', page: {} },
      { key: 'd' },
    ];
    const form = Object.fromEntries(
      entries.map((e) => [
        e.key,
        {
          ...(e.page === undefined ? {} : { page: e.page }),
          ...(e.column ? { column: e.column } : {}),
          ...(e.row ? { row: e.row } : {}),
        },
      ]),
    );
    const properties = Object.fromEntries(entries.map((e) => [e.key, { type: 'text' as const }]));
    const model = buildFormModel({ form, properties });
    expect(layoutOf(entries).pages.map((p) => p.lines.flat().map((c) => c.key))).toEqual(
      model.pages.map((p) => p.map((f) => f.key)),
    );
  });
});

describe('place', () => {
  const base = layoutOf([{ key: 'a' }, { key: 'b' }, { key: 'c' }]);

  it('puts a new cell on a line of its own', () => {
    expect(shape(place(base, 'n', { kind: 'line', page: 0, line: 1, column: 'full' }))).toEqual([
      { meta: undefined, lines: [['a:full'], ['n:full'], ['b:full'], ['c:full']] },
    ]);
  });

  it('moves a cell: the destination index is read in the layout the user sees', () => {
    const l = place(base, 'a', { kind: 'line', page: 0, line: 3, column: 'full' });
    expect(keysOf(l)).toEqual(['b', 'c', 'a']);
    // dropping a cell on the line after itself leaves the order alone
    expect(keysOf(place(base, 'a', { kind: 'line', page: 0, line: 1, column: 'full' }))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('fills the empty side of a half-width line and squeezes beside a full-width cell', () => {
    const half = setColumn(base, 'b', 'left');
    expect(shape(place(half, 'c', { kind: 'side', page: 0, line: 1, column: 'right' }))).toEqual([
      { meta: undefined, lines: [['a:full'], ['b:left', 'c:right']] },
    ]);
    expect(shape(place(base, 'c', { kind: 'beside', key: 'a', column: 'left' }))).toEqual([
      { meta: undefined, lines: [['c:left', 'a:right'], ['b:full']] },
    ]);
  });

  it('a page past the end is a new page', () => {
    expect(shape(place(base, 'n', { kind: 'page', page: 1 }))).toEqual([
      { meta: undefined, lines: [['a:full'], ['b:full'], ['c:full']] },
      { meta: {}, lines: [['n:full']] },
    ]);
  });

  it('a page goes with its last field', () => {
    const two = startPageAt(base, 'c');
    expect(two.pages).toHaveLength(2);
    expect(place(two, 'c', { kind: 'page', page: 0 }).pages).toHaveLength(1);
  });
});

describe('setColumn', () => {
  const pair = layoutOf([
    { key: 'a', column: 'left', row: 1 },
    { key: 'b', column: 'right', row: 1 },
  ]);

  it('a pair member that goes full width leaves the pair, in key order', () => {
    expect(shape(setColumn(pair, 'a', 'full'))).toEqual([
      { meta: undefined, lines: [['a:full'], ['b:right']] },
    ]);
    expect(shape(setColumn(pair, 'b', 'full'))).toEqual([
      { meta: undefined, lines: [['a:left'], ['b:full']] },
    ]);
  });

  it('a pair member that takes the other cell side swaps with it', () => {
    expect(shape(setColumn(pair, 'a', 'right'))).toEqual([
      { meta: undefined, lines: [['b:left', 'a:right']] },
    ]);
  });
});

describe('step', () => {
  const l = layoutOf([{ key: 'a' }, { key: 'b', page: {} }, { key: 'c' }]);

  it('passes lines, and continues into the next page at the edge of a page', () => {
    expect(shape(step(l, 'a', 1))).toEqual([{ meta: {}, lines: [['a:full'], ['b:full'], ['c:full']] }]);
    expect(shape(step(l, 'b', -1))).toEqual([
      { meta: undefined, lines: [['a:full'], ['b:full']] },
      { meta: {}, lines: [['c:full']] },
    ]);
  });

  it('a pair member leaves the pair first', () => {
    const pair = layoutOf([
      { key: 'a', column: 'left', row: 1 },
      { key: 'b', column: 'right', row: 1 },
    ]);
    expect(shape(step(pair, 'b', -1))).toEqual([{ meta: undefined, lines: [['b:right'], ['a:left']] }]);
  });
});

describe('pages', () => {
  it('startPageAt and joinPageAt undo each other, deletePage keeps every field', () => {
    const l = layoutOf([{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
    const two = startPageAt(l, 'b');
    expect(shape(two)).toEqual([
      { meta: undefined, lines: [['a:full']] },
      { meta: {}, lines: [['b:full'], ['c:full']] },
    ]);
    expect(shape(joinPageAt(two, 'b'))).toEqual(shape(l));
    expect(keysOf(deletePage(two, 1))).toEqual(['a', 'b', 'c']);
    expect(deletePage(two, 0).pages[0]?.meta).toEqual({});
  });

  it('the first page may carry a title', () => {
    const l = setPageMeta(layoutOf([{ key: 'a' }]), 0, { label: 'x' });
    expect(l.pages[0]?.meta).toEqual({ label: 'x' });
  });
});

// A random layout is made by a random run of edits from a flat form, so every state is one the editor can reach.
interface Edit {
  readonly t: string;
  readonly key: number;
  readonly to: number;
  readonly page: number;
  readonly line: number;
  readonly c: Column;
  readonly by: -1 | 1;
}
const edit: fc.Arbitrary<Edit> = fc.record({
  t: fc.constantFrom('place', 'side', 'beside', 'col', 'step', 'start', 'join', 'del', 'rm'),
  key: fc.nat(5),
  to: fc.nat(5),
  page: fc.nat(2),
  line: fc.nat(6),
  c: fc.constantFrom<Column>('full', 'left', 'right'),
  by: fc.constantFrom<-1 | 1>(-1, 1),
});

const half = (c: Column): 'left' | 'right' => (c === 'right' ? 'right' : 'left');

function run(edits: readonly Edit[]): Layout {
  let l = layoutOf(Array.from({ length: 6 }, (_, i) => ({ key: k(i) })));
  for (const e of edits) {
    const key = k(e.key);
    const dest: Dest | undefined =
      e.t === 'place'
        ? { kind: 'line', page: e.page, line: e.line, column: e.c }
        : e.t === 'side'
          ? { kind: 'side', page: e.page, line: e.line, column: half(e.c) }
          : e.t === 'beside'
            ? { kind: 'beside', key: k(e.to), column: half(e.c) }
            : undefined;
    if (dest !== undefined && !(dest.kind === 'beside' && dest.key === key)) l = place(l, key, dest);
    else if (e.t === 'col') l = setColumn(l, key, e.c);
    else if (e.t === 'step') l = step(l, key, e.by);
    else if (e.t === 'start') l = startPageAt(l, key);
    else if (e.t === 'join') l = joinPageAt(l, key);
    else if (e.t === 'del') l = deletePage(l, e.page);
    else if (e.t === 'rm') l = remove(l, key);
  }
  return l;
}

describe('properties of every reachable layout', () => {
  const edits = fc.array(edit, { maxLength: 25 });

  it('no key twice, no empty line or page, a pair is a left cell then a right cell, later pages have a marker', () => {
    fc.assert(
      fc.property(edits, (es) => {
        const l = run(es);
        const keys = keysOf(l);
        expect(new Set(keys).size).toBe(keys.length);
        for (const [i, p] of l.pages.entries()) {
          expect(p.lines.length).toBeGreaterThan(0);
          if (i > 0) expect(p.meta).toBeDefined();
          for (const line of p.lines) {
            expect(line.length).toBeGreaterThan(0);
            expect(line.length).toBeLessThanOrEqual(2);
            if (line.length === 2) expect(line.map((c) => c.column)).toEqual(['left', 'right']);
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it('no edit but remove loses a key', () => {
    fc.assert(
      fc.property(edits, (es) => {
        const kept = es.filter((e) => e.t !== 'rm');
        expect(keysOf(run(kept)).sort()).toEqual(Array.from({ length: 6 }, (_, i) => k(i)));
      }),
      { numRuns: 300 },
    );
  });

  it('the file round trip: the column, the row and the marker rebuild the same layout', () => {
    fc.assert(
      fc.property(edits, (es) => {
        const l = run(es);
        const rows = rowsOf(l, () => undefined);
        const entries: Placed[] = l.pages.flatMap((p, i) =>
          p.lines.flat().map((c, at) => ({
            key: c.key,
            column: c.column,
            row: rows.get(c.key),
            ...(at === 0 && (i > 0 || p.meta !== undefined) ? { page: p.meta ?? {} } : {}),
          })),
        );
        expect(shape(layoutOf(entries))).toEqual(shape(l));
      }),
      { numRuns: 400 },
    );
  });

  it('with rows left over from elsewhere, neighbouring lines still never share a row', () => {
    fc.assert(
      fc.property(edits, fc.array(fc.nat(3), { minLength: 6, maxLength: 6 }), (es, existing) => {
        const l = run(es);
        const rows = rowsOf(l, (key) => existing[Number(key.slice(1))]);
        for (const p of l.pages)
          p.lines.forEach((line, i) => {
            const mine = rows.get(line[0]?.key ?? '');
            const before = i > 0 ? rows.get(p.lines[i - 1]?.[0]?.key ?? '') : undefined;
            if (mine !== undefined) expect(mine).not.toBe(before);
          });
      }),
      { numRuns: 300 },
    );
  });
});
