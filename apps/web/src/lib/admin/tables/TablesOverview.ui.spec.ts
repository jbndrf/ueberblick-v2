// @vitest-environment jsdom
// WP-382: v3's Tabellen overview (`custom-tables/+page.svelte`) over the draft: list, inline create row, edit dialog,
// "Struktur bearbeiten" (v3's dead link now opens the table page), delete with confirm. Each is one draft call.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type { TablesApi } from './api';
import TablesOverview from './TablesOverview.svelte';

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-scroll') ? 600 : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-scroll') ? 1000 : 0;
  },
});

const ok = { ok: true, value: null } as const;
const make = () =>
  ({
    create: vi.fn(async () => ({ ok: true, value: { key: 'x' } })),
    update: vi.fn(async () => ok),
    remove: vi.fn(async () => ok),
    saveColumns: vi.fn(async () => ok),
    addRow: vi.fn(),
    deleteRow: vi.fn(),
  }) as unknown as { [K in keyof TablesApi]: ReturnType<typeof vi.fn> } & TablesApi;

const data = {
  tables: [
    {
      key: 'geraete',
      label: 'Geräte',
      description: 'Alles Gerät',
      mainLabel: 'Titel',
      audience: { kind: 'roles', roles: ['bauhof'] },
    },
    { key: 'strassen', label: 'Straßen', description: '', mainLabel: 'Name', audience: { kind: 'all' } },
  ],
  roles: [
    { key: 'bauhof', label: 'Bauhof' },
    { key: 'verwaltung', label: 'Verwaltung' },
  ],
};

let api: ReturnType<typeof make>;
const reload = vi.fn(async () => undefined);
const draftChanged = vi.fn();
const open = vi.fn();
beforeEach(() => {
  api = make();
  reload.mockClear();
  draftChanged.mockClear();
  open.mockClear();
});
const mount = (d = data) =>
  render(TablesOverview, {
    data: d as never,
    locale: 'de',
    project: 'demo',
    api,
    reload,
    open,
    draftChanged,
  });
const rowEl = (key: string) =>
  screen.getAllByRole('row').find((r) => r.getAttribute('data-row-id') === key) as HTMLElement;
const menuItem = (name: string) =>
  waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
      (e) => e.textContent?.trim() === name,
    );
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });

describe('the Tabellen overview', () => {
  it('lists the tables with v3 columns; the Hauptspalte is the first column, "Alle" is an empty audience', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Tabellen' })).toBeTruthy();
    expect(screen.getByText('Datentabellen für Ihr Projekt verwalten')).toBeTruthy();
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    for (const h of ['Tabellenname', 'Anzeigename', 'Beschreibung', 'Hauptspalte', 'Sichtbar für Rollen'])
      expect(heads).toContain(h);
    const g = within(rowEl('geraete'));
    expect(g.getByText('Geräte')).toBeTruthy();
    expect(g.getByText('Titel')).toBeTruthy();
    expect(g.getByText('Bauhof')).toBeTruthy();
    expect(within(rowEl('strassen')).getByText('Alle')).toBeTruthy();
  });

  it('with no table, the add row stays (as v3 hides the empty text while inline creation is on)', () => {
    mount({ tables: [], roles: [] });
    expect(document.querySelector('[data-add-row]')).toBeTruthy();
  });

  it('an inline edit in Bearbeitungsmodus renames the table: one draft call', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(screen.getByRole('switch', { name: 'Tabellen inline bearbeiten' }));
    await user.click(within(rowEl('geraete')).getByRole('button', { name: 'Geräte' }));
    const box = screen.getByRole('textbox');
    await user.clear(box);
    await user.type(box, 'Maschinen{Enter}');
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('geraete', { name: 'Maschinen' }));
    expect(draftChanged).toHaveBeenCalled();
  });

  it('the create row needs table name, display name and Hauptspalte, then makes the table', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const add = document.querySelector('[data-add-row]') as HTMLElement;
    const cells = within(add).getAllByRole('button');
    // table name, display name, description, Hauptspalte: the first four cells are text editors
    for (const [i, text] of ['woerter', 'Wörter', '', 'Wort'].entries()) {
      if (text === '') continue;
      await user.click(cells[i + 0] as HTMLElement);
      await user.type(screen.getByRole('textbox'), `${text}{Enter}`);
    }
    await user.click(within(add).getByRole('button', { name: 'Zeile hinzufügen' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'woerter', name: 'Wörter', mainColumn: 'Wort' }),
    );
    expect(reload).toHaveBeenCalled();
  });

  it('the row menu: Bearbeiten opens the dialog and saves name, description, Hauptspalte and roles in one call', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(within(rowEl('geraete')).getByRole('button', { name: 'Menü öffnen' }));
    await user.click(await menuItem('Bearbeiten'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Tabelle bearbeiten' }));
    expect((dialog.getByLabelText('Tabellenname') as HTMLInputElement).disabled).toBe(true);
    const name = dialog.getByLabelText('Anzeigename');
    await user.clear(name);
    await user.type(name, 'Maschinen');
    const main = dialog.getByLabelText('Hauptspalte');
    await user.clear(main);
    await user.type(main, 'Bezeichnung');
    await user.click(dialog.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith('geraete', {
      name: 'Maschinen',
      description: 'Alles Gerät',
      mainColumn: 'Bezeichnung',
      roles: ['bauhof'],
    });
  });

  it('"Struktur bearbeiten" opens the table page (v3 linked to a page that did not exist)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(within(rowEl('strassen')).getByRole('button', { name: 'Menü öffnen' }));
    await user.click(await menuItem('Struktur bearbeiten'));
    expect(open).toHaveBeenCalledWith('/admin/projects/demo/tables/strassen');
  });

  it('Löschen asks first and then removes the table from the draft', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(within(rowEl('strassen')).getByRole('button', { name: 'Menü öffnen' }));
    await user.click(await menuItem('Löschen'));
    expect(api.remove).not.toHaveBeenCalled();
    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText(/Mit dem nächsten Veröffentlichen/)).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('strassen'));
    expect(draftChanged).toHaveBeenCalled();
  });
});
