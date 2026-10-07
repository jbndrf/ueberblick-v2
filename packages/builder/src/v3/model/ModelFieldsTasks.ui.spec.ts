// @vitest-environment jsdom
import { tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { applyOps, openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { registerFieldPane } from '../field/register';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from '../task';
import { addToTabOps } from './fields/layout-ops';
import { registerModelView } from './permissions';

beforeAll(() => {
  class Noop {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver ??= Noop as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
});
afterEach(cleanup);

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function mount(doc: Doc = clean()) {
  const registry = createBuilderRegistry();
  registerModelView(registry);
  registerFieldPane(registry);
  registerTaskPane(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, view: 'model', onchange });
  const last = (): Doc => (onchange.mock.calls.at(-1)?.[0] as Doc) ?? doc;
  return { last, user: userEvent.setup() };
}

const card = (key: string): HTMLElement => document.querySelector(`[data-field="${key}"]`) as HTMLElement;

describe('Felder is the first tab of the Modell view and lists every field (acceptance 1)', () => {
  it('opens on Felder, with the v3 tab order, search, add button and the Daten and Ausgeblendet tabs', () => {
    mount();
    const tabs = screen.getAllByRole('tab').filter((t) => t.id.startsWith('model-tab-'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Felder', 'Berechtigungen', 'Aufgaben']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    const hub = within(screen.getByTestId('field-hub'));
    expect(hub.getByRole('searchbox', { name: 'Felder suchen' })).toBeTruthy();
    expect(hub.getByRole('button', { name: 'Feld hinzufügen' })).toBeTruthy();
    expect(hub.getByRole('tab', { name: 'Daten' })).toBeTruthy();
    expect(hub.getByRole('tab', { name: /Ausgeblendet \(0\)/ })).toBeTruthy();
  });

  it('shows label, type, key and where the field is used; required fields carry the star', () => {
    mount();
    const befund = within(card('befund'));
    expect(befund.getByText('Befund')).toBeTruthy();
    expect(befund.getByText('Text', { exact: false })).toBeTruthy();
    expect(befund.getByText('befund')).toBeTruthy();
    expect(befund.getByTestId('used-in').textContent).toMatch(/2 Aufgaben/);
    expect(within(card('intern_notiz')).getByTestId('used-in').textContent).toContain('Nicht verwendet');
    expect(card('geometrie')).toBeNull();
  });

  it('search filters the fields and says how many match', async () => {
    const { user } = mount();
    await user.type(screen.getByRole('searchbox', { name: 'Felder suchen' }), 'höhe');
    expect(card('hoehe_m')).not.toBeNull();
    expect(card('hoehe_klasse')).not.toBeNull();
    expect(card('befund')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('2 Treffer');
    await user.clear(screen.getByRole('searchbox', { name: 'Felder suchen' }));
    await user.type(screen.getByRole('searchbox', { name: 'Felder suchen' }), 'gibtsnicht');
    expect(screen.getByText('Kein Feld passt zur Suche.')).toBeTruthy();
  });

  it('a card opens the Felddefinition pane of that field (one editor)', async () => {
    const { user } = mount();
    await user.click(within(card('hoehe_m')).getByRole('button', { name: /Felddefinition öffnen: Höhe/ }));
    const pane = await screen.findByTestId('field-pane');
    expect(pane.getAttribute('data-path')).toBe('types.baum.properties.hoehe_m');
  });
});

describe('Felder lays the Daten view out (v3 FieldHub)', () => {
  it('hides a field into the library and shows it again on the Daten tab', async () => {
    const { user, last } = mount();
    await user.click(within(card('intern_notiz')).getByRole('button', { name: 'Aus Daten-Tabs ausblenden' }));
    expect(last().effective().types?.['baum']?.properties['intern_notiz']?.display?.hidden).toBe(true);
    expect(card('intern_notiz')).toBeNull();
    await user.click(screen.getByRole('tab', { name: /Ausgeblendet \(1\)/ }));
    expect(screen.getByText(/Alle ausgeblendeten Felder/)).toBeTruthy();
    await user.click(within(card('intern_notiz')).getByRole('button', { name: 'Auf Daten-Tab anzeigen' }));
    expect(last().effective().types?.['baum']?.properties['intern_notiz']?.display?.hidden).toBeUndefined();
    await user.click(screen.getByRole('tab', { name: 'Daten' }));
    expect(card('intern_notiz')).not.toBeNull();
  });

  it('a drop onto a tab writes tab and tab_order like the pane and the buttons do', async () => {
    const base = clean();
    const f = base.effective();
    const r = applyOps(base, addToTabOps(f, 'baum', 'befund', 'Messung', 'de'));
    if ('refused' in r) throw new Error(r.refused.message);
    const { last } = mount(r.doc);
    const chip = document.querySelector('[data-tab="Messung"]') as HTMLElement;
    await dragGrip('intern_notiz', chip);
    const d = last().effective().types?.['baum']?.properties['intern_notiz']?.display;
    expect(d).toMatchObject({ tab: { de: 'Messung' }, tab_order: 1 });
  });

  it('shows an empty library with v3 wording', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('tab', { name: /Ausgeblendet/ }));
    expect(screen.getByText('Noch keine Felder hier.')).toBeTruthy();
  });

  it('"Feld hinzufügen" creates a hidden property and opens its Felddefinition (acceptance 3)', async () => {
    const { user, last } = mount();
    await user.click(screen.getByRole('button', { name: 'Feld hinzufügen' }));
    const added = last().effective().types?.['baum']?.properties['neues_feld'];
    expect(added).toMatchObject({ type: 'text', label: { de: 'Neues Feld' }, display: { hidden: true } });
    expect((await screen.findByTestId('field-pane')).getAttribute('data-path')).toBe(
      'types.baum.properties.neues_feld',
    );
    expect(screen.getByRole('tab', { name: /Ausgeblendet \(1\)/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(card('neues_feld')).not.toBeNull();
  });

  it('deletes a field entirely after the confirm dialog names where it is used; the stage property cannot', async () => {
    const { user, last } = mount();
    expect(within(card('stage')).queryByRole('button', { name: /vollständig löschen/ })).toBeNull();
    await user.click(within(card('befund')).getByRole('button', { name: /Feld Befund vollständig löschen/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Feld „Befund“ löschen?')).toBeTruthy();
    expect(within(dialog).getByText(/Formular/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    expect(last().effective().types?.['baum']?.properties['befund']).toBeUndefined();
    expect(last().effective().tasks?.['kontrolle']?.form?.['befund']).toBeUndefined();
  });
});

/** A grip drag onto `target` (this jsdom has no PointerEvent: a mouse event of the pointer type). */
async function dragGrip(key: string, target: HTMLElement): Promise<void> {
  document.elementsFromPoint = () => [target];
  const grip = within(card(key) as HTMLElement).getByTestId('field-grip');
  const fire = (to: EventTarget, type: string, y: number) =>
    to.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: y }));
  fire(grip, 'pointerdown', 50);
  fire(window, 'pointermove', 10);
  fire(window, 'pointerup', 10);
  await tick();
}

describe('the cards re-lay the Daten view out without dragging (phone)', () => {
  const order = (): string[] =>
    [...document.querySelectorAll('.layout-row [data-field]')].map((e) => e.getAttribute('data-field') ?? '');
  const arrange = async (user: ReturnType<typeof userEvent.setup>, key: string) =>
    user.click(within(card(key)).getByTestId('arrange').querySelector('summary') as HTMLElement);

  it('a card is dragged by its grip into the gap above the first line; there are no up/down buttons', async () => {
    mount();
    const [a, b] = order();
    expect(screen.queryByRole('button', { name: /nach (oben|unten)/ })).toBeNull();
    await dragGrip(b as string, screen.getByTestId('hub-zone-0'));
    expect(order().slice(0, 2)).toEqual([b, a]);
  });

  it('the position select puts a card left or right of the one above, and back to full width', async () => {
    const { user, last } = mount();
    const [a, b] = order();
    await arrange(user, b as string);
    await user.selectOptions(
      within(card(b as string)).getByRole('combobox', { name: /Position von/ }),
      'right',
    );
    const props = () => last().effective().types?.['baum']?.properties ?? {};
    expect(props()[b as string]?.display).toMatchObject({ row: 0, column: 'right' });
    expect(props()[a as string]?.display).toMatchObject({ row: 0, column: 'left' });
    await user.selectOptions(
      within(card(b as string)).getByRole('combobox', { name: /Position von/ }),
      'full',
    );
    expect(props()[b as string]?.display?.column).toBeUndefined();
  });

  it('"In Tab verschieben" sends a card to Ausgeblendet, and the library is offered as a target', async () => {
    const { user, last } = mount();
    const [a] = order();
    await arrange(user, a as string);
    const pick = within(card(a as string)).getByRole('combobox', { name: 'In Tab verschieben' });
    expect([...pick.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Daten', 'Ausgeblendet']);
    await user.selectOptions(pick, 'Ausgeblendet');
    expect(last().effective().types?.['baum']?.properties[a as string]?.display?.hidden).toBe(true);
    expect(card(a as string)).toBeNull();
  });
});

describe('Aufgaben lists the tasks of the Objektart (acceptance 2)', () => {
  async function openTab() {
    const m = mount();
    await m.user.click(screen.getByRole('tab', { name: 'Aufgaben' }));
    return m;
  }

  it('has a header row and one row per task with name, Phase, roles, start, form fields and target', async () => {
    await openTab();
    const table = within(screen.getByRole('table', { name: 'Aufgaben der Objektart' }));
    for (const h of [
      'Name',
      'Angeboten in Phase',
      'Wer darf dies nutzen',
      'Start',
      'Formularfelder',
      'Ziel',
    ]) {
      expect(table.getByRole('columnheader', { name: h })).toBeTruthy();
    }
    const row = within(document.querySelector('[data-task="kontrolle"]') as HTMLElement);
    expect(row.getByText('Regelkontrolle')).toBeTruthy();
    expect(row.getByText('Baumkontrolle')).toBeTruthy();
    expect(row.getByText('In jeder Phase')).toBeTruthy();
    expect(row.getByText('5')).toBeTruthy();
    expect(row.getByText(/→ Maßnahme/)).toBeTruthy();
    expect(
      within(document.querySelector('[data-task="erfassen"]') as HTMLElement).getByText('Eingang'),
    ).toBeTruthy();
  });

  it('a row opens the task pane of that task', async () => {
    const { user } = await openTab();
    await user.click(document.querySelector('[data-task="befund_ergaenzen"] td') as HTMLElement);
    expect((await screen.findByTestId('task-pane')).getAttribute('data-task')).toBe('befund_ergaenzen');
    expect(document.querySelector('[data-task="befund_ergaenzen"]')?.className).toContain('selected');
  });

  it("shows v3's empty state when the Objektart has no task", async () => {
    const registry = createBuilderRegistry();
    registerModelView(registry);
    render(BuilderShell, { doc: clean(), type: 'baumart', locale: 'de', registry, view: 'model' });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Aufgaben' }));
    expect(within(screen.getByTestId('tasks-table')).getByText('Noch keine Aufgaben.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
