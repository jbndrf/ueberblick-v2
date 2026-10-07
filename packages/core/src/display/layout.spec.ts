import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB, layoutTabs, type LayoutTab } from './layout';

type Display = Parameters<typeof layoutTabs>[0][number]['display'];
const item = (value: string, display?: Display) => ({ value, display });
const lineValues = (t: LayoutTab<string> | undefined): string[][] =>
  (t?.lines ?? []).map((l) => l.map((c) => c.value));

describe('layoutTabs: the Daten ordering shared by the reader and the builder (R1)', () => {
  it('puts the default tab first, the others by tab_order then name, and leaves hidden ones out', () => {
    const tabs = layoutTabs(
      [
        item('a', { tab: { de: 'Zeta' }, tab_order: 1 }),
        item('b', { tab: { de: 'Alpha' }, tab_order: 1 }),
        item('c', { tab: { de: 'Erste' }, tab_order: 0 }),
        item('d'),
        item('e', { hidden: true }),
      ],
      { locale: 'de' },
    );
    expect(tabs.map((x) => x.name)).toEqual([DEFAULT_TAB, 'Erste', 'Alpha', 'Zeta']);
    expect(tabs.flatMap((t) => t.cells.map((c) => c.value))).not.toContain('e');
  });

  it('sorts by row, then left < right < full, then type order; a row is one line, an unplaced property its own', () => {
    const [tab] = layoutTabs(
      [
        item('x'),
        item('r', { row: 1, column: 'right' }),
        item('l', { row: 1, column: 'left' }),
        item('first', { row: 0 }),
        item('y'),
      ],
      { locale: 'de' },
    );
    expect(lineValues(tab)).toEqual([['first'], ['l', 'r'], ['x'], ['y']]);
  });

  it('keeps an empty default tab only when asked', () => {
    const one = [item('a', { tab: { de: 'T' } })];
    expect(layoutTabs(one, { locale: 'de' }).map((t) => t.name)).toEqual(['T']);
    expect(layoutTabs(one, { locale: 'de', keepDefaultTab: true }).map((t) => t.name)).toEqual([
      DEFAULT_TAB,
      'T',
    ]);
  });
});
