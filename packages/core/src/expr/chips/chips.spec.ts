import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Expr } from '../ast';
import { toSexpr } from '../__fixtures__/sexpr';
import { parse } from '../parse';
import type { Chip } from '../sql/contract';
import { fromChips, toChips } from '.';

const BIG = { maxLength: 1_000_000, maxDepth: 64 };
function ast(src: string): Expr {
  const p = parse(src, BIG);
  if (!p.ok) throw new Error(`parse ${src}`);
  return p.ast;
}

const SIMPLE = [
  "self.stage == 'aktiv'",
  'self.hoehe > 10',
  'self.hoehe >= 10.5 && self.alter < 50',
  "self.stage == 'aktiv' && self.hoehe > 10 && self.alter != 3",
  "self.stage == 'a' || self.stage == 'b'",
  "self.art == 'x' || self.hoehe > 1 && self.alter > 2",
  "self.hoehe > 1 && self.alter > 2 || self.art == 'x'",
  "self.art in ['Linde', 'Eiche']",
  'self.meta.x == null',
  'self.ok == true && self.hoehe < -3',
  "actor.id == 'inspector'",
];

describe('toChips: simple conditions round-trip', () => {
  it.each(SIMPLE)('%s', (src) => {
    const a = ast(src);
    const r = toChips(a);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(toSexpr(fromChips(r.chips))).toBe(toSexpr(a));
  });

  it('gives compare and join chips in order', () => {
    const r = toChips(ast("self.stage == 'aktiv' && self.hoehe > 10"));
    expect(r).toEqual({
      ok: true,
      chips: [
        { kind: 'compare', left: 'self.stage', op: '==', right: 'aktiv' },
        { kind: 'join', op: '&&' },
        { kind: 'compare', left: 'self.hoehe', op: '>', right: 10 },
      ],
    });
  });
});

describe('toChips: complex conditions fall back to text', () => {
  it.each([
    "(self.stage == 'a' || self.stage == 'b') && self.alter > 3",
    "self.hoehe > 1 && (self.alter > 2 && self.art == 'x')",
    "self.art.startsWith('Li')",
    '10 < self.hoehe',
    'self.hoehe > self.alter',
    '!(self.hoehe > 1)',
    'has(self.notiz)',
    'self.hoehe > 1.0',
    "self.tags.exists(t, t == 'a')",
    'self.hoehe + 1 > 2',
  ])('%s', (src) => {
    const r = toChips(ast(src));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(toSexpr(ast(r.text))).toBe(toSexpr(ast(src)));
  });
});

describe('toChips: long flat chains (A-005 item 6)', () => {
  it('a 16k-term chain of comparisons round-trips', () => {
    const src = Array.from({ length: 16_000 }, (_, i) => `self.a == ${i}`).join(' || ');
    const r = toChips(ast(src));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.chips).toHaveLength(31_999);
  });

  it('a 16k-term chain with a non-simple term falls back to text without overflowing the stack', () => {
    const src = Array.from({ length: 16_000 }, (_, i) => (i === 7 ? 'self.a.foo()' : 'self.a == 1')).join(
      ' && ',
    );
    const r = toChips(ast(src));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.text.length).toBe(src.length);
  });
});

describe('fromChips', () => {
  it('rebuilds with the precedence of the language', () => {
    const chips: Chip[] = [
      { kind: 'compare', left: 'self.a', op: '==', right: 1 },
      { kind: 'join', op: '||' },
      { kind: 'compare', left: 'self.b', op: '==', right: 2 },
      { kind: 'join', op: '&&' },
      { kind: 'compare', left: 'self.c', op: '==', right: 3 },
    ];
    expect(toSexpr(fromChips(chips))).toBe(toSexpr(ast('self.a == 1 || self.b == 2 && self.c == 3')));
  });

  it('is total: no chips is true, a stray join is ignored', () => {
    expect(toSexpr(fromChips([]))).toBe('true');
    expect(() => fromChips([{ kind: 'join', op: '&&' }])).not.toThrow();
  });
});

/* Property: a generated chip list survives fromChips then toChips. */
const chip = fc.record({
  kind: fc.constant('compare' as const),
  left: fc.constantFrom('self.a', 'self.b', 'self.meta.x', 'actor.id'),
  op: fc.constantFrom('==' as const, '!=' as const, '<' as const, '<=' as const, '>' as const, '>=' as const),
  right: fc.oneof(
    fc.integer({ min: -100, max: 100 }),
    fc.string({ maxLength: 6 }),
    fc.boolean(),
    fc.constant(null),
  ),
});
const join = fc.record({
  kind: fc.constant('join' as const),
  op: fc.constantFrom('&&' as const, '||' as const),
});

describe('property: chips round-trip', () => {
  it('toChips(fromChips(chips)) gives the chips back', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(join, chip), { maxLength: 8 }), chip, (rest, first) => {
        const chips: Chip[] = [first, ...rest.flatMap(([j, c]) => [j, c])];
        const r = toChips(fromChips(chips));
        expect(r).toEqual({ ok: true, chips });
      }),
    );
  });
});
