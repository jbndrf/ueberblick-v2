// @vitest-environment jsdom
// WP-382: the table page. The header edits name, description and roles in place (draft edits); the column manager adds,
// edits, removes and reorders columns as ONE list per change (Q15: the first column is the Hauptspalte, Q16: the draft).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type { TablesApi } from './api';
import TablePage from './TablePage.svelte';

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
const api = (): { [K in keyof TablesApi]: ReturnType<typeof vi.fn> } & TablesApi =>
  ({
    create: vi.fn(async () => ({ ok: true, value: { key: 'x' } })),
    update: vi.fn(async () => ok),
    remove: vi.fn(async () => ok),
    saveColumns: vi.fn(async () => ok),
    addRow: vi.fn(async () => ({ ok: true, value: { id: 'f' } })),
    deleteRow: vi.fn(async () => ok),
  }) as never;

const data = (over: Record<string, unknown> = {}) => ({
  project: 'demo',
  key: 'geraete',
  summary: {
    key: 'geraete',
    label: 'Geräte',
    description: 'Alles Gerät',
    mainLabel: 'Titel',
    audience: { kind: 'all' },
  },
  columns: [
    { key: 'titel', label: 'Titel', type: 'text', required: true, pending: false },
    { key: 'stueck', label: 'Stück', type: 'number', required: false, default: 2, pending: false },
    { key: 'neu', label: 'Neu', type: 'boolean', required: false, pending: true },
  ],
  roles: [
    { key: 'bauhof', label: 'Bauhof' },
    { key: 'verwaltung', label: 'Verwaltung' },
  ],
  deployed: null,
  names: {},
  importing: {
    published: true,
    setup: {
      task: '$create',
      type: 'geraete',
      taskLabel: 'Geräte',
      fields: [
        { key: 'titel', label: 'Titel', required: true, kind: 'text' },
        { key: 'stueck', label: 'Stück', required: false, kind: 'number' },
      ],
      geometry: null,
      stage: null,
      constants: [],
    },
  },
  ...over,
});

let a: ReturnType<typeof api>;
const reload = vi.fn(async () => undefined);
const draftChanged = vi.fn();
beforeEach(() => {
  a = api();
  reload.mockClear();
  draftChanged.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rows: [], next: null, total: 0 }) })),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mount = (d = data()) =>
  render(TablePage, { data: d as never, locale: 'de', api: a, reload, draftChanged });

describe('the header', () => {
  it('shows name, description and the audience; renaming is one draft edit and tells the shell', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    expect(screen.getByTestId('table-name').textContent).toContain('Geräte');
    expect(screen.getByTestId('table-description').textContent).toContain('Alles Gerät');
    expect(screen.getByTestId('table-roles').textContent).toContain('Alle');
    await user.click(screen.getByTestId('table-name'));
    const box = screen.getByTestId('table-name-input');
    await user.clear(box);
    await user.type(box, 'Maschinen{Enter}');
    await waitFor(() => expect(a.update).toHaveBeenCalledWith('geraete', { name: 'Maschinen' }));
    expect(draftChanged).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('Escape leaves the name as it was; an unchanged name sends nothing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(screen.getByTestId('table-name'));
    await user.type(screen.getByTestId('table-name-input'), 'x{Escape}');
    expect(a.update).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('table-name'));
    await user.type(screen.getByTestId('table-name-input'), '{Enter}');
    expect(a.update).not.toHaveBeenCalled();
  });

  it('the description is edited in place', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(screen.getByTestId('table-description'));
    const box = screen.getByTestId('table-description-input');
    await user.clear(box);
    await user.type(box, 'Neu{Enter}');
    await waitFor(() => expect(a.update).toHaveBeenCalledWith('geraete', { description: 'Neu' }));
  });

  it('a refused edit is a toast and changes nothing', async () => {
    a.update.mockResolvedValueOnce({ ok: false, message: 'Nicht erlaubt' });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(screen.getByTestId('table-name'));
    await user.type(screen.getByTestId('table-name-input'), 'x{Enter}');
    await waitFor(() => expect(a.update).toHaveBeenCalled());
    expect(draftChanged).not.toHaveBeenCalled();
    expect((await screen.findByTestId('table-name-error')).textContent).toBe('Nicht erlaubt');
    expect(screen.getByTestId('table-name-input')).toBeTruthy();
  });

  it('an empty name is refused under the field and sends nothing (the shared header block, as on the Objektart page)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(screen.getByTestId('table-name'));
    await user.clear(screen.getByTestId('table-name-input'));
    await user.keyboard('{Enter}');
    expect((await screen.findByTestId('table-name-error')).textContent).toContain('nicht leer');
    expect(a.update).not.toHaveBeenCalled();
  });

  it('the roles list shows the audience: named roles as badges, no see as "Niemand"', () => {
    const { unmount } = mount(
      data({ summary: { ...data().summary, audience: { kind: 'roles', roles: ['bauhof'] } } }),
    );
    expect(screen.getByTestId('table-roles').textContent).toContain('Bauhof');
    unmount();
    mount(data({ summary: { ...data().summary, audience: { kind: 'none' } } }));
    expect(screen.getByTestId('table-roles').textContent).toContain('Niemand');
  });
});

describe('a table before its first publish', () => {
  it('says the rows come with the publish, and still lets the admin define the columns', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const box = screen.getByTestId('table-unpublished');
    expect(box.textContent).toContain('Die Zeilen erscheinen nach dem ersten Veröffentlichen');
    await user.click(within(box).getByRole('button', { name: 'Spalte hinzufügen' }));
    expect(await screen.findByTestId('column-manager')).toBeTruthy();
  });
});

describe('the column manager', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      within(screen.getByTestId('table-unpublished')).getByRole('button', { name: 'Spalte hinzufügen' }),
    );
    return screen.findByTestId('column-manager');
  };

  it('lists the columns in order: the first is "Haupt", a draft-only column says it goes live with the publish', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const manager = within(await open(user));
    const first = within(manager.getByTestId('column-titel'));
    expect(first.getByText('Haupt')).toBeTruthy();
    expect(first.getByText('Pflichtfeld')).toBeTruthy();
    expect(within(manager.getByTestId('column-stueck')).getByText('Standard: 2')).toBeTruthy();
    expect(
      within(manager.getByTestId('column-neu')).getByText('neu, wird mit Veröffentlichen aktiv'),
    ).toBeTruthy();
  });

  it('adding a column sends the whole list with the new column at the end and a temporary key', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const manager = within(await open(user));
    await user.click(manager.getByTestId('column-add'));
    const form = within(await screen.findByRole('dialog', { name: 'Neue Spalte hinzufügen' }));
    await user.type(form.getByLabelText('Spaltenname'), 'Menge');
    await user.type(form.getByLabelText('Standardwert (optional)'), '7');
    await user.click(form.getByLabelText('Pflichtfeld'));
    await user.click(form.getByRole('button', { name: 'Spalte hinzufügen' }));
    await waitFor(() => expect(a.saveColumns).toHaveBeenCalledTimes(1));
    const [table, list] = a.saveColumns.mock.calls[0] as [string, { key: string }[]];
    expect(table).toBe('geraete');
    expect(list.map((c) => c.key)).toEqual(['titel', 'stueck', 'neu', 'new:1']);
    expect(list[3]).toEqual({ key: 'new:1', label: 'Menge', type: 'text', required: true, default: '7' });
    expect(draftChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses a name that exists already, as v3 did, and sends nothing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const manager = within(await open(user));
    await user.click(manager.getByTestId('column-add'));
    const form = within(await screen.findByRole('dialog', { name: 'Neue Spalte hinzufügen' }));
    await user.type(form.getByLabelText('Spaltenname'), 'titel');
    await user.click(form.getByRole('button', { name: 'Spalte hinzufügen' }));
    expect(await screen.findByText('Eine Spalte mit diesem Namen existiert bereits')).toBeTruthy();
    expect(a.saveColumns).not.toHaveBeenCalled();
  });

  it('moving a column down sends the new order; the top column cannot move up', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const manager = within(await open(user));
    const up = manager.getByRole('button', { name: 'Nach oben: Titel' }) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    await user.click(manager.getByRole('button', { name: 'Nach unten: Titel' }));
    await waitFor(() => expect(a.saveColumns).toHaveBeenCalledTimes(1));
    expect((a.saveColumns.mock.calls[0]?.[1] as { key: string }[]).map((c) => c.key)).toEqual([
      'stueck',
      'titel',
      'neu',
    ]);
  });

  it('the grip drags a column to its place, and ArrowUp on the grip moves it one up (the kit sortable)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const manager = within(await open(user));
    const saved = () => a.saveColumns.mock.calls.map((c) => (c[1] as { key: string }[]).map((k) => k.key));
    await fireEvent.dragStart(manager.getByTestId('column-titel'));
    await fireEvent.dragOver(manager.getByTestId('column-stueck'), { clientY: 100 });
    await fireEvent.drop(manager.getByTestId('column-stueck'));
    await waitFor(() => expect(saved()[0]).toEqual(['stueck', 'titel', 'neu']));
    manager.getByRole('button', { name: 'Verschieben: Stück' }).focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(saved()[1]).toEqual(['titel', 'neu', 'stueck']));
  });

  it('removing a column asks first, then sends the list without it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const manager = within(await open(user));
    await user.click(manager.getByRole('button', { name: 'Spalte löschen: Stück' }));
    expect(a.saveColumns).not.toHaveBeenCalled();
    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText(/Mit dem nächsten Veröffentlichen/)).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: 'Spalte löschen' }));
    await waitFor(() => expect(a.saveColumns).toHaveBeenCalledTimes(1));
    expect((a.saveColumns.mock.calls[0]?.[1] as { key: string }[]).map((c) => c.key)).toEqual([
      'titel',
      'neu',
    ]);
  });

  it('editing renames a column and keeps its key', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const manager = within(await open(user));
    await user.click(manager.getByRole('button', { name: 'Spalte bearbeiten: Stück' }));
    const form = within(await screen.findByRole('dialog', { name: 'Spalte bearbeiten: Stück' }));
    const name = form.getByLabelText('Spaltenname');
    await user.clear(name);
    await user.type(name, 'Anzahl');
    await user.click(form.getByRole('button', { name: 'Änderungen speichern' }));
    await waitFor(() => expect(a.saveColumns).toHaveBeenCalledTimes(1));
    expect(a.saveColumns.mock.calls[0]?.[1]).toContainEqual({
      key: 'stueck',
      label: 'Anzahl',
      type: 'number',
      default: 2,
    });
  });
});

describe("'CSV importieren' (owner A8, v3's place: before 'Aktualisieren')", () => {
  it('sits in the header before Aktualisieren and opens the shared wizard, mapping the columns of the table', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const button = screen.getByTestId('csv-import-button');
    expect(button.textContent).toContain('CSV importieren');
    const refresh = screen.getByRole('button', { name: /Aktualisieren/ });
    expect(button.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(button);
    const dialog = await screen.findByTestId('csv-import');
    expect(dialog.textContent).toContain('CSV-Daten importieren');
    const file = new File(['Titel;Stück\nPumpe;2\n'], 'geraete.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('Titel;Stück\nPumpe;2\n') }); // jsdom's File has no text()
    await fireEvent.change(screen.getByTestId('csv-file'), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByTestId('map-0') as HTMLSelectElement).value).toBe('titel'));
    expect((screen.getByTestId('map-1') as HTMLSelectElement).value).toBe('stueck');
    // no coordinate columns and no stage: a Tabelle has neither
    expect(screen.queryByText('Längengrad (lon)')).toBeNull();
    expect(document.querySelector('#import-stage')).toBeNull();
  });
});
