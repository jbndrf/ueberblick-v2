import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Chip, Json } from '@ueberblick/core';
import {
  appendChip,
  chipsOfSource,
  chipsToSource,
  literalText,
  parseLiteral,
  removeChip,
  updateChip,
  type CompareChip,
} from './chips';

const path = fc.constantFrom(
  'self.stage',
  'self.vitalitaet',
  'form.hoehe_m',
  'actor.id',
  'self.flaeche.name',
);
const scalar: fc.Arbitrary<Json> = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer({ min: 0, max: 100000 }),
  fc.boolean(),
  fc.constant(null),
);
const compare: fc.Arbitrary<CompareChip> = fc.oneof(
  fc.record({
    kind: fc.constant('compare' as const),
    left: path,
    op: fc.constantFrom('==', '!=', '<', '<=', '>', '>=') as fc.Arbitrary<'=='>,
    right: scalar,
  }),
  fc.record({
    kind: fc.constant('compare' as const),
    left: path,
    op: fc.constant('in' as const),
    right: fc.array(scalar, { minLength: 0, maxLength: 3 }) as fc.Arbitrary<Json>,
  }),
);
const join: fc.Arbitrary<Chip> = fc.record({
  kind: fc.constant('join' as const),
  op: fc.constantFrom('&&', '||') as fc.Arbitrary<'&&'>,
});
/** A well-formed chip list: compare (join compare)*. */
const chipList: fc.Arbitrary<readonly Chip[]> = fc
  .array(fc.tuple(join, compare), { maxLength: 4 })
  .chain((rest) => compare.map((first): readonly Chip[] => [first, ...rest.flat()]));

const wellFormed = (chips: readonly Chip[]) =>
  chips.length % 2 === 1 && chips.every((c, i) => c.kind === (i % 2 === 0 ? 'compare' : 'join'));

const extra: CompareChip = { kind: 'compare', left: 'self.n', op: '==', right: 1 };

describe('chips round trip (R5)', () => {
  it('edit chip -> expression -> the same chips (property)', () => {
    fc.assert(
      fc.property(chipList, (chips) => {
        expect(chipsOfSource(chipsToSource(chips))).toEqual({ ok: true, chips });
      }),
      { numRuns: 300 },
    );
  });

  it('a literal survives its own text (property)', () => {
    fc.assert(
      fc.property(fc.oneof(scalar, fc.array(scalar, { maxLength: 4 })), (v) => {
        expect(parseLiteral(literalText(v as Json))).toEqual({ ok: true, value: v });
      }),
      { numRuns: 300 },
    );
  });

  it('a chip edit changes exactly the edited value', () => {
    const r = chipsOfSource("self.stage == 'aktiv' && self.hoehe > 10");
    if (!r.ok) throw new Error('chips expected');
    const edited = updateChip(r.chips, 2, { kind: 'compare', left: 'self.hoehe', op: '>', right: 12 });
    expect(chipsToSource(edited)).toBe("self.stage == 'aktiv' && self.hoehe > 12");
  });

  it('a negative number typed as text is the same value or refused, never another value', () => {
    const r = parseLiteral('-3');
    if (r.ok) expect(r.value).toBe(-3);
  });

  it('refuses a right-hand side that is not a literal', () => {
    expect(parseLiteral('self.x')).toEqual({ ok: false });
    expect(parseLiteral('1 +')).toEqual({ ok: false });
    expect(parseLiteral('')).toEqual({ ok: false });
  });
});

describe('complex conditions fall back to text', () => {
  it.each([
    "'kontrolle' in actor.roles && self.stage != 'erledigt'",
    '(self.a == 1 || self.b == 2) && self.c == 3',
    'size(self.massnahmen) > 0',
    'self.a == 1 ? true : false',
  ])('%s', (src) => {
    const r = chipsOfSource(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.text.length).toBeGreaterThan(0);
  });

  it('text that does not parse stays text', () => {
    expect(chipsOfSource('self.a ==')).toEqual({ ok: false, text: 'self.a ==' });
  });
});

describe('chip list steps keep the list well formed (property)', () => {
  it('append', () => {
    fc.assert(
      fc.property(chipList, (chips) => {
        const out = appendChip(chips, extra);
        expect(wellFormed(out)).toBe(true);
        expect(out.length).toBe(chips.length + 2);
      }),
    );
    expect(appendChip([], extra)).toEqual([extra]);
  });

  it('remove', () => {
    fc.assert(
      fc.property(chipList, fc.nat(), (chips, n) => {
        const compares = chips.map((_, i) => i).filter((i) => i % 2 === 0);
        const out = removeChip(chips, compares[n % compares.length] as number);
        if (chips.length === 1) expect(out).toEqual([]);
        else expect(wellFormed(out)).toBe(true);
      }),
    );
  });

  it('remove of a join or an unknown index changes nothing; update keeps the kind', () => {
    const chips = chipsOfSource('self.a == 1 && self.b == 2');
    if (!chips.ok) throw new Error('chips expected');
    expect(removeChip(chips.chips, 1)).toBe(chips.chips);
    expect(removeChip(chips.chips, 9)).toBe(chips.chips);
    expect(updateChip(chips.chips, 1, extra)).toBe(chips.chips);
  });
});
