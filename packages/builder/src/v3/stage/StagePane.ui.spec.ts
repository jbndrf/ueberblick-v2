// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import userEvent from '@testing-library/user-event';
import { openProject } from '../../doc';
import { goldenProjects } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerStagePane } from './index';
import '../task/shims.testing';

const project = goldenProjects.find((p) => p.name.startsWith('stadtwerke'));
if (project === undefined) throw new Error('golden project missing');
const meldungen = project;

function frame(type: string) {
  const source = meldungen;
  const registry = createBuilderRegistry();
  registerStagePane(registry);
  const onsave = vi.fn<(overlay: string) => Promise<'saved'>>(async () => 'saved');
  render(BuilderShell, {
    doc: openProject(source.templateSrc, source.overlaySrc),
    type,
    locale: 'de',
    registry,
    onsave,
  });
  return { onsave };
}

const addStage = () => userEvent.click(screen.getByRole('button', { name: 'Phase' }));
const saved = async (onsave: ReturnType<typeof frame>['onsave']): Promise<string> => {
  await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  return String(onsave.mock.calls.at(-1)?.[0]);
};

describe('stage pane', () => {
  it('shows the Standardansicht with the data when nothing is selected', () => {
    frame('meldung');
    expect(screen.getByText('Standardansicht')).toBeTruthy();
    expect(screen.queryByTestId('stage-buttons')).toBeNull();
    expect(screen.getByTestId('stage-data')).toBeTruthy();
  });

  it('a new stage opens in the pane with its name and type; Ende writes process.end', async () => {
    const { onsave } = frame('meldung');
    await addStage();
    expect(screen.getByRole('button', { name: 'Phasenname' }).textContent?.trim()).toBe('Neue Phase');
    const type = screen.getByTestId('stage-type') as HTMLSelectElement;
    expect(type.value).toBe('intermediate');
    await userEvent.selectOptions(type, 'end');
    expect((screen.getByTestId('stage-type') as HTMLSelectElement).value).toBe('end');
    expect(await saved(onsave)).toMatch(/neue_phase/);
    expect(await saved(onsave)).toMatch(/end:[\s\S]*neue_phase/);
  });

  it('the start cannot be switched off; the pane says what to do', async () => {
    frame('meldung');
    await addStage();
    await userEvent.selectOptions(screen.getByTestId('stage-type'), 'start');
    expect((screen.getByTestId('stage-type') as HTMLSelectElement).value).toBe('start');
    await userEvent.selectOptions(screen.getByTestId('stage-type'), 'end');
    expect(screen.getByTestId('stage-notice').textContent).toContain('andere Startphase');
    expect((screen.getByTestId('stage-type') as HTMLSelectElement).value).toBe('start');
  });

  it('renames in place; the catalog entry and the saved overlay carry the new label', async () => {
    const { onsave } = frame('meldung');
    await addStage();
    await userEvent.click(screen.getByRole('button', { name: 'Phasenname' }));
    const input = screen.getByRole('textbox', { name: 'Phasenname' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Prüfung{Enter}');
    expect(screen.getByRole('button', { name: 'Phasenname' }).textContent?.trim()).toBe('Prüfung');
    expect(await saved(onsave)).toContain('Prüfung');
  });

  it('the role picker dims the buttons the role is not offered, with the reason', async () => {
    frame('meldung');
    await addStage();
    const buttons = screen.getByTestId('stage-buttons');
    expect(
      within(buttons)
        .queryAllByTestId('stage-button')
        .some((b) => b.dataset['dimmed'] === 'true'),
    ).toBe(false);
    await userEvent.selectOptions(screen.getByTestId('stage-role'), 'melder');
    const dimmed = within(buttons)
      .getAllByTestId('stage-button')
      .filter((b) => b.dataset['dimmed'] === 'true');
    expect(dimmed.length).toBeGreaterThan(0);
    expect(dimmed.every((b) => (b.getAttribute('title') ?? '').startsWith('Nicht angeboten'))).toBe(true);
  });

  it('"+" adds a task pinned to the stage and selects it', async () => {
    const { onsave } = frame('meldung');
    await addStage();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionsschaltfläche hinzufügen' }));
    expect(screen.queryByTestId('stage-pane')).toBeNull();
    expect(await saved(onsave)).toContain("self.status == 'neue_phase'");
  });

  it('delete asks first, lists what breaks, and removes the stage on confirm', async () => {
    const { onsave } = frame('meldung');
    await addStage();
    await userEvent.click(screen.getByTestId('stage-delete'));
    expect(screen.getByTestId('confirm-delete').textContent).toContain('Neue Phase');
    await userEvent.click(screen.getByTestId('confirm-delete-action'));
    expect(screen.getByText('Standardansicht')).toBeTruthy();
    expect(await saved(onsave)).not.toContain('neue_phase');
  });

  it('the field palette widens the pane from 520 to 720 px and back (v3 InspectorHost)', async () => {
    frame('meldung');
    const width = () =>
      (screen.getByTestId('builder-inspector') as HTMLElement).style.getPropertyValue('--pane-w');
    expect(width()).toBe('520px');
    await userEvent.click(screen.getByTestId('stage-library-toggle'));
    expect(width()).toBe('720px');
    await userEvent.click(screen.getByTestId('stage-library-toggle'));
    expect(width()).toBe('520px');
  });

  it('the close button deselects', async () => {
    frame('meldung');
    await addStage();
    await userEvent.click(screen.getByTestId('stage-close'));
    expect(screen.getByText('Standardansicht')).toBeTruthy();
  });
});

describe('the Daten tabs of the stage pane (WP-444, v3 DataTabsSection)', () => {
  const tab = (name: string) => screen.getByRole('tab', { name });
  const props = () => screen.queryAllByTestId('stage-property').map((p) => p.dataset['property']);
  const addTab = () => userEvent.click(screen.getByRole('button', { name: 'Tab hinzufügen' }));
  const openLibrary = () =>
    userEvent.click(screen.getByRole('button', { name: 'Felder zum aktiven Tab hinzufügen' }));
  const items = () => screen.getAllByTestId('stage-library-item');
  const rename = async (to: string) => {
    await userEvent.click(screen.getByRole('button', { name: 'Tab-Name' }));
    const input = screen.getByRole('textbox', { name: 'Tab-Name' });
    await userEvent.clear(input);
    await userEvent.type(input, `${to}{Enter}`);
  };

  it('shows the default tab "Daten" with the properties and "Tab hinzufügen"', () => {
    frame('meldung');
    expect(tab('Daten').getAttribute('aria-selected')).toBe('true');
    expect(props().length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Tab hinzufügen' })).toBeTruthy();
    // the default tab cannot be renamed or deleted
    expect(screen.queryByRole('button', { name: 'Tab löschen' })).toBeNull();
  });

  it('adds a tab, renames it in place, fills it from the library and saves display.tab and tab_order', async () => {
    const { onsave } = frame('meldung');
    const first = props()[0] as string;
    await addTab();
    expect(tab('Neuer Tab').getAttribute('aria-selected')).toBe('true');
    expect(props()).toEqual([]);
    await rename('Messung');
    expect(tab('Messung').getAttribute('aria-selected')).toBe('true');
    await openLibrary();
    await userEvent.click(items().find((i) => i.dataset['property'] === first) as HTMLElement);
    expect(props()).toEqual([first]);
    const overlay = await saved(onsave);
    expect(overlay).toContain('Messung');
    expect(overlay).toMatch(/tab_order: 1/);
  });

  it('a card is dragged by its grip to another place in its tab and can leave it again ("Aus Tab entfernen")', async () => {
    frame('meldung');
    await addTab();
    await openLibrary();
    const keys = items()
      .slice(0, 2)
      .map((i) => i.dataset['property']);
    await userEvent.click(items()[0] as HTMLElement);
    await userEvent.click(items()[1] as HTMLElement);
    expect(props()).toEqual(keys);
    const card = (n: number) => screen.getAllByTestId('stage-property')[n]?.closest('li') as HTMLElement;
    expect(screen.queryByTestId('stage-move-up')).toBeNull();
    expect(screen.queryByTestId('stage-position')).toBeNull();
    const zone = screen.getByTestId('stage-zone-0');
    document.elementsFromPoint = () => [zone];
    const grip = within(card(1)).getByTestId('stage-grip');
    // This jsdom has no PointerEvent: a mouse event of the pointer type.
    const pointer = (target: EventTarget, type: string, clientY: number) =>
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY }));
    pointer(grip, 'pointerdown', 50);
    pointer(window, 'pointermove', 10);
    pointer(window, 'pointerup', 10);
    await tick();
    expect(props()).toEqual([keys[1], keys[0]]);
    await userEvent.click(within(card(0)).getByRole('button', { name: 'Aus Tab entfernen' }));
    expect(props()).toEqual([keys[0]]);
  });

  it('delete asks first, says the fields lose their tab, and keeps them in "Daten"', async () => {
    const { onsave } = frame('meldung');
    const before = props();
    await addTab();
    await openLibrary();
    await userEvent.click(items()[0] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Tab löschen' }));
    expect(screen.getByTestId('stage-tab-delete-confirm').textContent).toContain('ohne Tab');
    await userEvent.click(screen.getByTestId('stage-tab-delete-yes'));
    expect(screen.queryByRole('tab', { name: 'Neuer Tab' })).toBeNull();
    expect(tab('Daten').getAttribute('aria-selected')).toBe('true');
    expect([...props()].sort()).toEqual([...before].sort());
    expect(await saved(onsave)).not.toContain('Neuer Tab');
  });

  it('a name another tab has is refused with a notice', async () => {
    frame('meldung');
    await addTab();
    await openLibrary();
    await userEvent.click(items()[0] as HTMLElement);
    await rename('Daten');
    expect(screen.getByTestId('stage-notice').textContent).toContain('gibt es schon');
  });
});

describe('the stage pane goes through Paraglide', () => {
  const components = readdirSync(import.meta.dirname)
    .filter((f) => f.endsWith('.svelte'))
    .map((f) => join(import.meta.dirname, f));
  it.each(components)('%s has no literal user-visible text', (file) => {
    const code = readFileSync(file, 'utf8')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '');
    let markup = code;
    for (let prev = ''; prev !== markup;) {
      prev = markup;
      markup = markup.replace(/\{[^{}]*\}/g, '');
    }
    expect(
      [...markup.matchAll(/>([^<>]+)</g)].map((m) => (m[1] ?? '').trim()).filter((s) => /\p{L}/u.test(s)),
    ).toEqual([]);
    expect([...code.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g)].map((m) => m[1])).toEqual(
      [],
    );
  });
});
