// WP-659: the Daten layout (v3 getDataTabs / getVisibleDataTabs). Pure.
import { describe, expect, it } from 'vitest';
import type { FeatureType, Key } from '@ueberblick/core/model';
import type { PropertyRow } from '@ueberblick/ui';
import { buildDataLayout, DEFAULT_TAB } from './layout';

type Display = NonNullable<FeatureType['properties'][string]['display']>;
const row = (key: string, empty = false): PropertyRow => ({
  key: key as Key,
  label: key,
  kind: 'text',
  badges: [],
  multiline: false,
  text: empty ? 'Kein Wert' : 'x',
  empty,
  files: [],
  links: [],
});
const make = (display: Record<string, Display | undefined>): FeatureType =>
  ({
    label: 'T',
    properties: Object.fromEntries(
      Object.entries(display).map(([k, d]) => [
        k,
        d === undefined ? { type: 'text' } : { type: 'text', display: d },
      ]),
    ),
  }) as unknown as FeatureType;
const layout = (
  display: Record<string, Display | undefined>,
  opts: { empty?: string[]; falseSet?: string[]; locale?: string } = {},
) => {
  const keys = Object.keys(display);
  return buildDataLayout({
    type: make(display),
    rows: keys.map((k) => row(k, opts.empty?.includes(k))),
    conditionFalse: new Set((opts.falseSet ?? []) as Key[]),
    locale: opts.locale ?? 'de',
  });
};
const shape = (l: ReturnType<typeof layout>) => l.tabs.map((t) => [t.name, t.rows.map((r) => r.key)]);

describe('buildDataLayout', () => {
  it('no settings: one default tab in type order', () => {
    expect(shape(layout({ a: undefined, b: undefined }))).toEqual([[DEFAULT_TAB, ['a', 'b']]]);
  });

  it('the default tab is first, the others by tab_order then name', () => {
    const l = layout({
      a: { tab: 'Zeta', tab_order: 1 },
      b: { tab: 'Alpha', tab_order: 1 },
      c: { tab: 'Eins', tab_order: 0 },
      d: undefined,
    });
    expect(l.tabs.map((t) => t.name)).toEqual([DEFAULT_TAB, 'Eins', 'Alpha', 'Zeta']);
  });

  it('the smallest tab_order among a tab’s properties places the tab', () => {
    const l = layout({
      a: { tab: 'X', tab_order: 9 },
      b: { tab: 'X', tab_order: 1 },
      c: { tab: 'Y', tab_order: 2 },
    });
    expect(l.tabs.map((t) => t.name)).toEqual(['X', 'Y']);
  });

  it('order places rows within a tab; unplaced rows follow in type order', () => {
    const l = layout({ a: undefined, b: { row: 2 }, c: { row: 1 }, d: undefined });
    expect(shape(l)).toEqual([[DEFAULT_TAB, ['c', 'b', 'a', 'd']]]);
  });

  it('hidden never shows; a false condition hides the row', () => {
    const l = layout(
      { a: undefined, b: { hidden: true }, c: { condition: 'false' }, d: undefined },
      { falseSet: ['c'] },
    );
    expect(shape(l)).toEqual([[DEFAULT_TAB, ['a', 'd']]]);
  });

  it('a tab whose rows are all hidden or empty is not offered (v3: hide tab, collapse rows)', () => {
    const l = layout({ a: undefined, b: { tab: 'Leer' }, c: { tab: 'Weg', hidden: true } }, { empty: ['b'] });
    expect(l.tabs.map((t) => t.name)).toEqual([DEFAULT_TAB]);
  });

  it('an empty row stays inside a tab that has a value', () => {
    expect(shape(layout({ a: undefined, b: undefined }, { empty: ['b'] }))).toEqual([
      [DEFAULT_TAB, ['a', 'b']],
    ]);
  });

  it('a localized tab name follows the reader’s language', () => {
    const d = { a: { tab: { de: 'Kontrolle', en: 'Inspection' } } };
    expect(layout(d, { locale: 'de' }).tabs[0]?.name).toBe('Kontrolle');
    expect(layout(d, { locale: 'en' }).tabs[0]?.name).toBe('Inspection');
  });

  it('the history hint is kept per property, also on a hidden row', () => {
    const l = layout({
      a: { history: 'measurements' },
      b: { hidden: true, history: 'changes' },
      c: undefined,
    });
    expect(l.hints).toEqual({ a: 'measurements', b: 'changes' });
  });

  it('every shown row appears exactly once (property)', () => {
    const l = layout({
      a: { tab: 'X', row: 3 },
      b: { tab: 'Y' },
      c: { tab: 'X', row: 1 },
      d: undefined,
      e: { tab: 'Y', row: 0 },
    });
    const keys = l.tabs.flatMap((t) => t.rows.map((r) => r.key)).sort();
    expect(keys).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  const lines = (l: ReturnType<typeof layout>) =>
    l.tabs[0]?.lines.map((line) => line.map((c) => `${c.row.key}:${c.column}`));

  it('cells with the same row share a line, left before right before full (v3 groupFieldsByLayout)', () => {
    const l = layout({
      a: { row: 1, column: 'right' },
      b: { row: 1, column: 'left' },
      c: { row: 0 },
      d: { row: 2, column: 'full' },
      e: { row: 2, column: 'left' },
    });
    expect(lines(l)).toEqual([['c:full'], ['b:left', 'a:right'], ['e:left', 'd:full']]);
    expect(l.tabs[0]?.rows.map((r) => r.key)).toEqual(['c', 'b', 'a', 'e', 'd']);
  });

  it('a property without a row is a line of its own, after the placed ones, in type order', () => {
    const l = layout({
      a: undefined,
      b: { row: 3, column: 'left' },
      c: undefined,
      d: { row: 3, column: 'right' },
    });
    expect(lines(l)).toEqual([['b:left', 'd:right'], ['a:full'], ['c:full']]);
  });

  it('a lone half-width cell keeps its column (v3 renders it at half width)', () => {
    expect(lines(layout({ a: { row: 0, column: 'left' } }))).toEqual([['a:left']]);
  });

  it('rows of different tabs never share a line', () => {
    const l = layout({ a: { row: 0, column: 'left' }, b: { tab: 'X', row: 0, column: 'right' } });
    expect(l.tabs.map((t) => t.lines.length)).toEqual([1, 1]);
  });
});
