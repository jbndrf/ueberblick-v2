// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, Json } from '@ueberblick/core/model';
import FeatureList from './FeatureList.svelte';
import { inExtent, sortFeatures } from './list';
import { pointFeature } from './test-helpers';
import { axeViolations } from '../testing/axe';

const labels = {
  caption: 'Trees in view',
  empty: 'Nothing here',
  sortedAscending: 'ascending',
  sortedDescending: 'descending',
  name: 'Name',
};
const columns = [{ key: 'height', label: 'Height' }];
/** The rows the app builds: each with its display name (`displayName` in core). */
const named = (fs: readonly { id: string; properties: { [key: string]: Json } }[]) =>
  fs.map((f) => ({
    id: f.id as FeatureId,
    name: String(f.properties.name ?? `Baum #${f.id}`),
    properties: f.properties,
  }));
const features = [
  pointFeature('a', 8, 50, { name: 'Oak', height: 12 }),
  pointFeature('b', 9, 51, { name: 'Ash', height: 30 }),
  pointFeature('c', 30, 60, { name: 'Elm', height: 5 }),
];

describe('list cells (WP-713)', () => {
  it('shows a cell as its column formats it, the raw value only when the column has no format', () => {
    const cols = [
      { key: 'height', label: 'Height', format: (v: Json | undefined) => `${String(v)} m` },
      { key: 'raw', label: 'Raw' },
    ];
    const rows = named([pointFeature('a', 8, 50, { name: 'Oak', height: 12, raw: 'v2' })]);
    render(FeatureList, { features: rows, columns: cols, labels, onFeatureTap: () => undefined });
    expect(screen.getByText('12 m')).toBeDefined();
    expect(screen.getByText('v2')).toBeDefined();
  });
});

describe('list alternative', () => {
  it('shows exactly the features it is given, one row each', () => {
    const shown = inExtent(features, [0, 40, 20, 55]);
    render(FeatureList, { features: named(shown), columns, labels, onFeatureTap: () => undefined });
    expect(screen.getAllByRole('row')).toHaveLength(1 + 2); // header + 2
    expect(screen.queryByText('Elm')).toBeNull();
  });

  it('is sortable by the view sort and by column buttons', async () => {
    render(FeatureList, {
      features: named(features),
      columns,
      labels,
      sort: ['-height'],
      onFeatureTap: () => undefined,
    });
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent?.trim());
    expect(names()[0]).toContain('Ash');
    await userEvent.setup().click(screen.getByRole('button', { name: /Name/ }));
    expect(names()[0]).toContain('Ash'); // ascending by name: Ash, Elm, Oak
    expect(names()[2]).toContain('Oak');
    await userEvent.setup().click(screen.getByRole('button', { name: /Name/ }));
    expect(names()[0]).toContain('Oak');
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe('descending');
  });

  it('shows the display name in the first cell, and the id only inside the fallback name', () => {
    const items = [{ id: 'f-9' as FeatureId, name: 'Baum #f-9', properties: { height: 3 } }];
    render(FeatureList, { features: items, columns, labels, onFeatureTap: () => undefined });
    const first = screen.getAllByRole('row')[1]?.querySelector('button.ub-open');
    expect(first?.textContent?.trim()).toBe('Baum #f-9');
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeTruthy();
  });

  it('is keyboard-operable: Enter on a row button opens the same featureTap', async () => {
    const tap = vi.fn();
    render(FeatureList, { features: named(features), columns, labels, sort: ['$name'], onFeatureTap: tap });
    const user = userEvent.setup();
    await user.tab(); // the scroll region (WP-855)
    await user.tab(); // first sort button
    await user.tab();
    await user.tab(); // first row's open button
    await user.keyboard('{Enter}');
    expect(tap).toHaveBeenCalledWith('b'); // Ash
  });

  it('shows the empty text and has no axe violations', async () => {
    const { container } = render(FeatureList, {
      features: [],
      columns,
      labels,
      onFeatureTap: () => undefined,
    });
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

// WP-742 (hunt 5, finding 6): a header cell wraps between words and never splits one ("Baumar / t"); only a body cell with a
// long id may break anywhere (WCAG 1.4.10).
describe('header wrapping', () => {
  it('a header cell breaks only at word boundaries', () => {
    render(FeatureList, {
      features: [],
      columns: [{ key: 'art', label: 'Baumart' }],
      labels,
      onFeatureTap: () => undefined,
    });
    const head = screen.getByRole('columnheader', { name: /Baumart/ });
    expect(getComputedStyle(head).overflowWrap).not.toBe('anywhere');
    expect(getComputedStyle(screen.getByRole('button', { name: /Baumart/ })).overflowWrap).not.toBe(
      'anywhere',
    );
  });
});

describe('sortFeatures (property)', () => {
  it('is a permutation, ordered, and stable under reversal of the input', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 30 }), (heights) => {
        const fs = heights.map((h, i) => pointFeature(`f${String(i).padStart(3, '0')}`, 0, 0, { h }));
        const sorted = sortFeatures(fs, ['h']);
        expect(sorted).toHaveLength(fs.length);
        const hs = sorted.map((f) => f.properties.h as number);
        expect(hs).toEqual([...hs].sort((x, y) => x - y));
        expect(sortFeatures([...fs].reverse(), ['h']).map((f) => f.id)).toEqual(sorted.map((f) => f.id));
      }),
    );
  });
});

describe('FeatureList narrow screens (WP-855)', () => {
  it('the table scrolls inside its own focusable region, never the page', () => {
    render(FeatureList, { features: named(features), columns, labels, onFeatureTap: () => undefined });
    const region = screen.getByRole('region', { name: 'Trees in view' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.querySelector('table')).toBeTruthy();
  });
});
