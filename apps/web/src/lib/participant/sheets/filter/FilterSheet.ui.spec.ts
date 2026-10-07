// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Key } from '@ueberblick/core/model';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import FilterSheet from './FilterSheet.svelte';
import { createFilterController } from './filter-controller';
import { isVisible, memoryPrefs } from './filter-state';
import type { FilterCard, FilterData } from './filter-model';
import type { FilterViews } from './filter-views';

const DOT = { color: '#2b6cb0', size: 32 } as const;
const cards: FilterCard[] = [
  {
    type: 'baum' as Key,
    label: 'Baum',
    count: 3,
    color: '#2b6cb0',
    look: DOT,
    values: [
      { value: 'erfasst', label: 'Erfasst', count: 2, color: '#2b6cb0', look: DOT },
      { value: 'erledigt', label: 'Erledigt', count: 1, color: '#2b6cb0', look: DOT },
    ],
  },
  { type: 'flaeche' as Key, label: 'Fläche', count: 1, color: '#2b6cb0', look: DOT, values: [] },
];
const data = (c: readonly FilterCard[]): FilterData => ({ cards: () => c, subscribe: () => () => undefined });

function open(locale: 'de' | 'en' = 'de', c: readonly FilterCard[] = cards) {
  const controller = createFilterController(memoryPrefs());
  const view = render(FilterSheet, { open: true, data: data(c), controller, locale });
  return { controller, ...view };
}

describe('FilterSheet (Einfach)', () => {
  it('shows v3 Karteninhalt without an overlay, so the map stays usable', () => {
    open();
    expect(screen.getByText('Karteninhalt')).toBeTruthy();
    expect(screen.getByText('Elemente auf der Karte ein- oder ausblenden')).toBeTruthy();
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
  });

  it('one card per Objektart with its count and a switch', () => {
    open();
    const baum = screen.getByRole('switch', { name: 'Baum' });
    expect(baum.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Fläche' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('switching a card off hides that Objektart on the map, and on shows it again', async () => {
    const { controller } = open();
    await fireEvent.click(screen.getByRole('switch', { name: 'Baum' }));
    expect(isVisible(controller.state(), 'baum' as Key, 'erfasst')).toBe(false);
    expect(screen.getByRole('switch', { name: 'Baum' }).getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(screen.getByRole('switch', { name: 'Baum' }));
    expect(isVisible(controller.state(), 'baum' as Key, 'erfasst')).toBe(true);
  });

  it('only a card with stages has a chevron; expanded it shows one switch per stage with its count', async () => {
    const { controller } = open();
    expect(screen.queryByRole('button', { name: 'Fläche aufklappen' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Baum aufklappen' }));
    const erledigt = screen.getByRole('switch', { name: 'Erledigt' });
    expect(within(erledigt.closest('[data-row]') as HTMLElement).getByText('1')).toBeTruthy();
    await fireEvent.click(erledigt);
    expect(isVisible(controller.state(), 'baum' as Key, 'erledigt')).toBe(false);
    expect(isVisible(controller.state(), 'baum' as Key, 'erfasst')).toBe(true);
  });

  it('stage switches stay enabled while the type switch is off, as v3, and show off', async () => {
    const { controller } = open();
    await fireEvent.click(screen.getByRole('button', { name: 'Baum aufklappen' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Baum' }));
    const erfasst = screen.getByRole('switch', { name: 'Erfasst' });
    expect(erfasst.hasAttribute('disabled')).toBe(false);
    expect(erfasst.getAttribute('aria-checked')).toBe('false');
    // v3: a stage switched on shows the type again, with only that stage
    await fireEvent.click(erfasst);
    expect(screen.getByRole('switch', { name: 'Baum' }).getAttribute('aria-checked')).toBe('true');
    expect(isVisible(controller.state(), 'baum' as Key, 'erfasst')).toBe(true);
    expect(isVisible(controller.state(), 'baum' as Key, 'erledigt')).toBe(false);
  });

  it('switching the last stage off switches the type off (v3)', async () => {
    open();
    await fireEvent.click(screen.getByRole('button', { name: 'Baum aufklappen' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Erfasst' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Erledigt' }));
    expect(screen.getByRole('switch', { name: 'Baum' }).getAttribute('aria-checked')).toBe('false');
  });

  it('every card and row has a dot in its colour (the engine has no icons yet, G1); rows are v3 compact', async () => {
    open();
    await fireEvent.click(screen.getByRole('button', { name: 'Baum aufklappen' }));
    const dots = document.querySelectorAll('[data-dot]');
    expect(dots.length).toBe(4); // two cards, two rows
    expect((dots[0] as HTMLElement).getAttribute('style')).toContain('background-color');
    expect((document.querySelector('[data-row]') as HTMLElement).getAttribute('style')).toContain(
      'zoom: 0.8',
    );
  });

  it('says so when the device holds nothing to show', () => {
    open('de', []);
    expect(screen.getByText('Kein Karteninhalt verfügbar')).toBeTruthy();
  });

  it('speaks English from the catalogue', () => {
    open('en');
    expect(screen.getByText('Map content')).toBeTruthy();
    expect(screen.getByText('Show or hide items on the map')).toBeTruthy();
  });

  it('has no axe violations, collapsed and expanded', async () => {
    const { baseElement } = open();
    const sheet = baseElement.querySelector('[data-slot="sheet-content"]') as Element;
    expect(await axeViolations(sheet)).toEqual([]);
    await fireEvent.click(screen.getByRole('button', { name: 'Baum aufklappen' }));
    expect(await axeViolations(sheet)).toEqual([]);
  });

  it('every string it uses is in both catalogues', () => {
    const read = (l: string) =>
      JSON.parse(
        readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), '../../../../../messages', `${l}.json`),
          'utf8',
        ),
      ) as Record<string, string>;
    const de = read('de');
    const en = read('en');
    const keys = Object.keys(de).filter((k) => k.startsWith('participant_filter_'));
    expect(keys.length).toBeGreaterThanOrEqual(6);
    // "Min" and "Max" are the same word in both languages (as in v3).
    const same = ['participant_filter_clause_number_max', 'participant_filter_clause_number_min'];
    for (const k of keys) {
      expect(en[k]).toBeTruthy();
      if (!same.includes(k)) expect(en[k]).not.toBe(de[k]);
    }
  });
});

describe('FilterSheet tabs and views (v3 :322-713)', () => {
  const views = (over: Partial<FilterViews> = {}): FilterViews => ({
    presets: [
      { key: 'meine', label: 'Meine Bäume' },
      { key: 'alle', label: 'Alle' },
    ],
    saved: [{ id: 's1', name: 'Mein Filter' }],
    ...over,
  });
  const withViews = (v: FilterViews | undefined, extra: object = {}) => {
    const controller = createFilterController(memoryPrefs());
    const view = render(FilterSheet, {
      open: true,
      data: data(cards),
      controller,
      locale: 'de',
      views: v,
      ...extra,
    });
    return { controller, ...view };
  };

  it('has no tab shell without views and without a contributed tab (v3: tools off)', () => {
    withViews(undefined);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('with views: tabs Einfach and Ansichten', async () => {
    withViews(views());
    expect(screen.getByRole('tab', { name: 'Einfach' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    expect(screen.getByText('Standard')).toBeTruthy();
    expect(screen.getByText('Vom Projekt')).toBeTruthy();
    expect(screen.getByText('Meine Bäume')).toBeTruthy();
  });

  it('a preset is picked directly (Q20), shows the banner, locks the switches; Ansicht ausschalten ends it', async () => {
    const { controller } = withViews(views());
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    await fireEvent.click(screen.getByRole('radio', { name: /Meine Bäume/ }));
    expect(controller.activeView()).toEqual({ kind: 'preset', key: 'meine' });
    await fireEvent.click(screen.getByRole('tab', { name: 'Einfach' }));
    expect(screen.getByText('„Meine Bäume“ ist aktiv')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Baum' }).hasAttribute('disabled')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Ansicht ausschalten' }));
    expect(controller.activeView()).toBeNull();
    expect(document.querySelector('[data-banner]')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Baum' }).hasAttribute('disabled')).toBe(false);
  });

  it('Standard ends the view', async () => {
    const { controller } = withViews(views());
    controller.setActiveView({ kind: 'saved', key: 's1' });
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    expect(controller.activeView()).toBeNull();
  });

  it('saved views: new, rename and delete, as v3', async () => {
    const calls: string[] = [];
    withViews(
      views({
        save: (n: string) => calls.push(`save ${n}`),
        rename: (id: string, n: string) => calls.push(`rename ${id} ${n}`),
        remove: (id: string) => calls.push(`remove ${id}`),
      }),
    );
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Neue Ansicht' }));
    const input = screen.getByPlaceholderText('Ansicht benennen…') as HTMLInputElement;
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.input(input, { target: { value: ' Neu ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Umbenennen' }));
    const edit = screen.getByRole('textbox', { name: 'Umbenennen' }) as HTMLInputElement;
    await fireEvent.input(edit, { target: { value: 'Anders' } });
    await fireEvent.keyDown(edit, { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(calls).toEqual(['save Neu', 'rename s1 Anders', 'remove s1']);
  });

  it('without a save function the person keeps no views: no "Neue Ansicht", presets only', async () => {
    withViews({ presets: [{ key: 'a', label: 'A' }] });
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    expect(screen.queryByRole('button', { name: 'Neue Ansicht' })).toBeNull();
    expect(screen.getByRole('radio', { name: /A/ })).toBeTruthy();
  });

  it('a tab a tool contributes shows after Ansichten; Tabs verwalten opens the tool switches', async () => {
    const body = createRawSnippet(() => ({ render: () => '<p>Cluster-Inhalt</p>' }));
    let managed = 0;
    withViews(undefined, {
      extraTabs: [{ key: 'cluster', label: 'Cluster', body }],
      onManageTabs: () => managed++,
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Cluster' }));
    expect(screen.getByText('Cluster-Inhalt')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Tabs verwalten' }));
    expect(managed).toBe(1);
  });

  it('Tabs verwalten sits clear of the sheet close button (WP-716: the icon overlapped the X)', () => {
    withViews(undefined, { onManageTabs: () => undefined });
    const manage = screen.getByRole('button', { name: 'Tabs verwalten' });
    // the kit puts Close at right-4 (16 px, 16 px wide); right-1 sat on top of it, right-12 clears it
    expect(manage.className).toContain('right-12');
    expect(manage.className).not.toMatch(/(^|\s)right-1(\s|$)/);
  });

  it('an open Ansichten tab falls back to Einfach when the tool is switched off (v3 edge case)', async () => {
    const { rerender } = withViews(views());
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    expect(screen.getByText('Standard')).toBeTruthy();
    await rerender({ views: undefined });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Baum' })).toBeTruthy();
  });

  it('shows the builder snippet under the active saved view only', async () => {
    const builder = createRawSnippet((active: () => { key: string }) => ({
      render: () => `<p data-testid="builder">Builder für ${active().key}</p>`,
    }));
    const { controller } = withViews(views(), { builder });
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    expect(screen.queryByTestId('builder')).toBeNull();
    controller.setActiveView({ kind: 'preset', key: 'meine' });
    await waitFor(() => expect(screen.queryByTestId('builder')).toBeNull());
    controller.setActiveView({ kind: 'saved', key: 's1' });
    expect((await screen.findByTestId('builder')).textContent).toBe('Builder für s1');
  });

  it('no Tabs verwalten button without a place to manage them', () => {
    withViews(views());
    expect(screen.queryByRole('button', { name: 'Tabs verwalten' })).toBeNull();
  });

  it('has no axe violations with tabs and the Ansichten tab', async () => {
    const { baseElement } = withViews(views());
    const sheet = baseElement.querySelector('[data-slot="sheet-content"]') as Element;
    expect(await axeViolations(sheet)).toEqual([]);
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    expect(await axeViolations(sheet)).toEqual([]);
  });
});

describe('filter controller', () => {
  it('keeps the state across sheet and map sessions through the prefs seam (memory until WP-612)', () => {
    const prefs = memoryPrefs();
    createFilterController(prefs).setType('baum' as Key, false);
    expect(isVisible(createFilterController(prefs).state(), 'baum' as Key, 'erfasst')).toBe(false);
  });

  it('tells subscribers on every change', () => {
    const c = createFilterController(memoryPrefs());
    let n = 0;
    c.subscribe(() => (n += 1));
    c.setType('baum' as Key, false);
    c.setValue('baum' as Key, 'x', false);
    expect(n).toBe(2);
  });
});

describe('FilterSheet (R14: no counting while closed)', () => {
  it('a change burst while closed does not recount; opening recounts once', async () => {
    let ring: () => void = () => undefined;
    let calls = 0;
    const counting: FilterData = {
      cards: () => (calls++, cards),
      subscribe: (l) => ((ring = l), () => undefined),
    };
    const controller = createFilterController(memoryPrefs());
    const view = render(FilterSheet, { open: false, data: counting, controller, locale: 'de' });
    for (let i = 0; i < 20; i++) ring();
    expect(calls).toBe(0);
    await view.rerender({ open: true });
    await Promise.resolve();
    expect(calls).toBe(1);
    ring();
    expect(calls).toBe(2);
  });
});
