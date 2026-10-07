// @vitest-environment jsdom
// WP-644: the Daten read view as v3: uppercase label, bordered value boxes, badges in option order, long text,
// empty placeholders, the gallery for photos, and the field history behind a count.
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, FeatureType, FoldedFeature, Key } from '@ueberblick/core/model';
import { buildFeatureSheetModel, type ActivityEntry, type FeatureSheetModel } from '@ueberblick/ui';
import '@ueberblick/ui/testing';
import DataTab from '../DataTab.svelte';
import { buildDataLayout } from './layout';

afterEach(() => {
  cleanup();
  // an open Dialog leaves `pointer-events: none` on the body
  document.body.removeAttribute('style');
});

const type: FeatureType = {
  label: 'Baum',
  geometry: 'lage',
  properties: {
    name: { type: 'text', label: 'Name' },
    notiz: { type: 'text', label: 'Notiz' },
    leer: { type: 'text', label: 'Leer' },
    arten: { type: 'multiselect', label: 'Arten', options: { a: 'Eiche', b: 'Buche', c: 'Ahorn' } },
    zustand: { type: 'select', label: 'Zustand', options: { gut: 'Gut' } },
    gepflanzt: { type: 'date', label: 'Gepflanzt' },
    foto: { type: 'file', label: 'Foto' },
    lage: { type: 'geometry', label: 'Lage' },
  },
};
const feature = {
  id: 't1' as FeatureId,
  type: 'baum' as Key,
  deleted: false,
  updatedSeq: 1,
  properties: {
    name: 'Alte Eiche',
    notiz: 'Zeile eins\nZeile zwei',
    arten: ['c', 'a'],
    gepflanzt: '2024-03-05',
  },
  derived: {},
} as unknown as FoldedFeature;

const run = (n: number, result: unknown): ActivityEntry => ({
  runId: `r${n}` as ActivityEntry['runId'],
  task: 'Kontrolle',
  actorLabel: 'Anna',
  at: `2026-01-0${n}T10:00:00.000Z` as ActivityEntry['at'],
  status: 'synced' as ActivityEntry['status'],
  changes: [{ property: 'name' as Key, result: result as never }],
});

function model(activity: ActivityEntry[] = [], locale = 'de'): FeatureSheetModel {
  return buildFeatureSheetModel({
    feature,
    type,
    types: { baum: type },
    availableTasks: [],
    taskLabels: {},
    edgesOut: [],
    edgesIn: [],
    activity,
    lookups: { participant: () => undefined, feature: () => undefined },
    locale,
  });
}
const show = (m: FeatureSheetModel, locale: 'de' | 'en' = 'de') =>
  render(DataTab, { model: m, locale, onopen: vi.fn() });
const field = (key: string): HTMLElement => document.querySelector(`[data-field-id="${key}"]`) as HTMLElement;

describe('value boxes', () => {
  it('an uppercase xs label over a bordered box', () => {
    show(model());
    const label = field('name').querySelector('dt') as HTMLElement;
    expect(label.className).toContain('uppercase');
    expect(label.className).toContain('text-xs');
    const box = within(field('name')).getByText('Alte Eiche');
    for (const c of ['min-h-10', 'rounded-md', 'border', 'bg-background', 'px-3', 'py-2'])
      expect(box.className).toContain(c);
  });

  it('long text keeps its line breaks in a min-h-[100px] pre-wrap box', () => {
    show(model());
    const box = field('notiz').querySelector('dd > div') as HTMLElement;
    expect(box.className).toContain('min-h-[100px]');
    expect(box.className).toContain('whitespace-pre-wrap');
    expect(box.textContent).toContain('Zeile eins\nZeile zwei');
  });

  it('selections are secondary badges in the declared option order, not the stored order', () => {
    show(model());
    const badges = Array.from(field('arten').querySelectorAll('[data-slot="badge"]'));
    expect(badges.map((b) => b.textContent?.trim())).toEqual(['Eiche', 'Ahorn']);
  });

  it('an empty value is an italic placeholder', () => {
    show(model());
    const empty = within(field('leer')).getByText('Kein Wert');
    expect(empty.className).toContain('italic');
    expect(within(field('zustand')).getByText('Kein Wert').closest('div')?.className).toContain('italic');
  });

  it('an empty file property shows the no-file box', () => {
    show(model());
    expect(within(field('foto')).getByText('Keine Datei').className).toContain('italic');
  });

  it('dates are in the locale of the user', () => {
    show(model());
    expect(within(field('gepflanzt')).getByText(/5\.\s?März 2024|05\.03\.2024/)).toBeTruthy();
    cleanup();
    show(model([], 'en'), 'en');
    expect(within(field('gepflanzt')).getByText(/Mar 5, 2024/)).toBeTruthy();
  });
});

describe('field history', () => {
  it('no count for a value that never changed', () => {
    show(model([run(1, 'x')]));
    expect(screen.queryByRole('button', { name: /Änderungen/ })).toBeNull();
  });

  it('the count opens the history with the values newest first, including Geleert', async () => {
    show(model([run(3, null), run(2, 'zwei'), run(1, 'eins')]));
    await userEvent.setup().click(within(field('name')).getByRole('button', { name: '3 Änderungen' }));
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Verlauf — Name')).toBeTruthy();
    expect(dialog.className).toContain('max-w-2xl');
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Geleert');
    expect(rows[0]?.querySelector('.italic')).toBeTruthy();
    expect(rows[1]?.textContent).toContain('zwei');
    expect(rows[2]?.textContent).toContain('eins');
    await user.keyboard('{Escape}');
  });

  it('English wording', () => {
    show(model([run(2, 'b'), run(1, 'a')], 'en'), 'en');
    expect(within(field('name')).getByRole('button', { name: '2 changes' })).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('has no axe violations', async () => {
    const { baseElement } = show(model([run(2, 'b'), run(1, 'a')]));
    const r = await axe.run(baseElement, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

// WP-659: the admin's sub-tabs and the history hint (v3 data `Tabs.Root` in the detail module, `CmmnFieldChrome`).
describe('sub-tabs and the history hint', () => {
  const withDisplay = (display: Record<string, unknown>, locale = 'de'): FeatureSheetModel => {
    const t = {
      ...type,
      properties: Object.fromEntries(
        Object.entries(type.properties).map(([k, p]) => [k, display[k] ? { ...p, display: display[k] } : p]),
      ),
    } as FeatureType;
    const m = buildFeatureSheetModel({
      feature,
      type: t,
      types: { baum: t },
      availableTasks: [],
      taskLabels: {},
      edgesOut: [],
      edgesIn: [],
      activity: [run(3, null), run(2, 'b'), run(1, 'a')],
      lookups: { participant: () => undefined, feature: () => undefined },
      locale,
    });
    return { ...m, layout: buildDataLayout({ type: t, rows: m.rows, locale }) } as FeatureSheetModel;
  };
  const layoutDisplay = {
    name: { history: 'measurements' },
    notiz: { tab: 'Kontrolle', tab_order: 1 },
    arten: { tab: 'Kontrolle', tab_order: 1, row: 0 },
    gepflanzt: { tab: 'Pflanzung', tab_order: 2 },
    leer: { hidden: true },
  };

  it('a scrollable list with the default tab "Daten" first, then the admin tabs', () => {
    show(withDisplay(layoutDisplay));
    const list = screen.getByTestId('daten-subtabs');
    expect(
      within(list)
        .getAllByRole('tab')
        .map((t) => t.textContent?.trim()),
    ).toEqual(['Daten', 'Kontrolle', 'Pflanzung']);
    expect(list.className).toContain('overflow-x-auto');
  });

  it('shows only the active tab’s rows; a tap switches, rows follow the configured order', async () => {
    show(withDisplay(layoutDisplay));
    expect(field('name')).toBeTruthy();
    expect(field('notiz')).toBeNull();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Kontrolle' }));
    expect(
      [...document.querySelectorAll('[data-testid="daten-property"]')].map((e) =>
        e.getAttribute('data-field-id'),
      ),
    ).toEqual(['arten', 'notiz']);
  });

  it('left and right cells of one row share a line as half-width cells', async () => {
    show(
      withDisplay({
        notiz: { tab: 'K', row: 1, column: 'right' },
        arten: { tab: 'K', row: 1, column: 'left' },
      }),
    );
    await userEvent.setup().click(screen.getByRole('tab', { name: 'K' }));
    const l = field('arten');
    const r = field('notiz');
    expect(l.className).toContain('w-[calc(50%-0.5rem)]');
    expect(l.className).toContain('min-w-0');
    expect(r.className).toContain('ml-auto');
    expect(l.parentElement).toBe(r.parentElement);
    expect(l.getAttribute('data-column')).toBe('left');
    expect(l.nextElementSibling).toBe(r);
  });

  it('hidden properties never show', () => {
    show(withDisplay(layoutDisplay));
    expect(field('leer')).toBeNull();
  });

  it('no settings: no sub-tab list', () => {
    show(withDisplay({}));
    expect(screen.queryByTestId('daten-subtabs')).toBeNull();
  });

  it('the count reads Messungen by the hint, Änderungen without it', () => {
    show(withDisplay(layoutDisplay));
    expect(within(field('name')).getByRole('button', { name: '3 Messungen' })).toBeTruthy();
  });

  it('English: readings', () => {
    show(withDisplay(layoutDisplay, 'en'), 'en');
    expect(within(field('name')).getByRole('button', { name: '3 readings' })).toBeTruthy();
  });

  it('a feature with nothing to show says so (v3 "No data yet")', () => {
    show(
      withDisplay({
        name: { hidden: true },
        notiz: { hidden: true },
        arten: { hidden: true },
        gepflanzt: { hidden: true },
      }),
    );
    expect(screen.getByText('Noch keine Daten')).toBeTruthy();
  });
});
