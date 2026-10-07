// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { overwriteGetLocale } from '../../../../../../packages/ui/src/paraglide/runtime.js';
import type * as Sonner from 'svelte-sonner';
import RelationsPage from './RelationsPage.svelte';
import type { RelationsApi } from './api';
import type { RelationRowData, RelationsPageData } from './types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  vi.clearAllMocks();
  overwriteGetLocale(() => 'en');
});

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const fakeApi = (over: Partial<Record<keyof RelationsApi, unknown>> = {}) =>
  ({
    create: vi.fn(() => ok({ id: 'baum.kontrollen' })),
    update: vi.fn((id: string) => ok({ id })),
    preview: vi.fn(() => ok({ uses: [], child: 'kontrolle', refKey: 'baum' })),
    remove: vi.fn(() => ok(null)),
    holding: vi.fn(() => Promise.resolve(0)),
    ...over,
  }) as unknown as RelationsApi & Record<keyof RelationsApi, ReturnType<typeof vi.fn>>;

const TYPES = [
  { key: 'baum', label: 'Baum', hasGeometry: true },
  { key: 'kontrolle', label: 'Kontrolle', hasGeometry: false },
  { key: 'massnahme', label: 'Maßnahme', hasGeometry: true },
];
const DATA: RelationsPageData = {
  types: TYPES,
  relations: [
    {
      id: 'baum.kontrollen',
      label: 'Kontrollen',
      parent: 'baum',
      parentLabel: 'Baum',
      child: 'kontrolle',
      childLabel: 'Kontrolle',
      refKey: 'baum',
      cardinality: 'many',
      attachment: 'enforced',
      onDelete: 'cascade',
      geometry: 'inherit',
      childHasGeometry: false,
      geometryProblem: false,
      source: 'template',
    },
    {
      id: 'baum.massnahme',
      label: 'Maßnahme',
      parent: 'baum',
      parentLabel: 'Baum',
      child: 'massnahme',
      childLabel: 'Maßnahme',
      refKey: 'baum',
      cardinality: 'one',
      attachment: 'optional',
      onDelete: 'nullify',
      geometry: 'draw',
      childHasGeometry: true,
      geometryProblem: false,
      source: 'overlay',
    },
  ],
  choices: {
    attachments: ['enforced', 'optional'],
    onDelete: ['cascade', 'nullify', 'block'],
    geometries: ['inherit', 'draw', 'none'],
  },
};

function mount(over: { data?: Partial<RelationsPageData>; api?: ReturnType<typeof fakeApi> } = {}) {
  const api = over.api ?? fakeApi();
  const reload = vi.fn(() => Promise.resolve());
  const view = render(RelationsPage, {
    data: { ...DATA, ...over.data },
    locale: 'de',
    api,
    reload,
  });
  return { ...view, api, reload };
}

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}

const SIZES = [
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
] as const;

describe.each(SIZES)('Beziehungen at %s', (_name, width) => {
  beforeEach(() => setViewport(width));

  it('has v3 header, create button and one row per relation (name, parent to child, multiplicity, provenance)', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Beziehungen' })).toBeTruthy();
    expect(screen.getByText(/Eltern-Kind-Beziehungen zwischen den Objektarten/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Beziehung erstellen' })).toBeTruthy();
    const row = document.querySelector('[data-relation="baum.kontrollen"]') as HTMLElement;
    expect(within(row).getByText('Kontrollen')).toBeTruthy();
    expect(within(row).getByText('Baum')).toBeTruthy();
    expect(within(row).getByText('Kontrolle')).toBeTruthy();
    expect(within(row).getByText('Mehrere')).toBeTruthy();
    expect(within(row).getByText('Vorlage')).toBeTruthy();
    expect(within(row).getByText('Verbindlich')).toBeTruthy();
    const own = document.querySelector('[data-relation="baum.massnahme"]') as HTMLElement;
    expect(within(own).getByText('Einzeln')).toBeTruthy();
    expect(within(own).queryByText('Vorlage')).toBeNull();
    expect(within(own).getByText('Optional')).toBeTruthy();
    // v3's geometry badge (relations/+page.svelte:191)
    expect(within(row).getByText('Vom Eltern-Objekt übernehmen')).toBeTruthy();
    expect(within(own).getByText('Eigene Geometrie zeichnen')).toBeTruthy();
  });

  it('shows the empty state when there is no relation', () => {
    mount({ data: { relations: [] } });
    expect(screen.getByText('Noch keine Beziehungen')).toBeTruthy();
    expect(screen.getByText('Erstellen Sie eine Beziehung, um zwei Objektarten zu verbinden.')).toBeTruthy();
  });

  it('has v3\'s Anbindung and "Wenn das Eltern-Objekt gelöscht wird" selects with v3\'s defaults', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Beziehung erstellen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beziehung erstellen' });
    for (const label of ['Name', 'Eltern-Objektart', 'Kind-Objektart', 'Multiplizität'])
      expect(within(dialog).getByLabelText(label)).toBeTruthy();
    const attachment = within(dialog).getByLabelText('Anbindung') as HTMLSelectElement;
    const onDelete = within(dialog).getByLabelText(
      'Wenn das Eltern-Objekt gelöscht wird',
    ) as HTMLSelectElement;
    expect(attachment.value).toBe('enforced');
    expect(onDelete.value).toBe('nullify');
    expect([...attachment.options].map((o) => o.text)).toEqual(['Verbindlich', 'Optional']);
    expect([...onDelete.options].map((o) => o.text)).toEqual([
      'Kinder mitlöschen',
      'Kinder trennen',
      'Löschen blockieren',
    ]);
    // v3 shows a help line under Anbindung that follows the choice
    expect(
      within(dialog).getByText('Kind-Objekte können nur vom Eltern-Objekt aus erstellt werden'),
    ).toBeTruthy();
    await user.selectOptions(attachment, 'optional');
    expect(within(dialog).getByText('Auch eigenständig erstellbar; beim Erstellen verknüpfbar')).toBeTruthy();
  });

  it('Geometrie beim Erstellen: a child without geometry offers übernehmen (default) and keine', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Beziehung erstellen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beziehung erstellen' });
    const geometry = within(dialog).getByLabelText('Geometrie beim Erstellen') as HTMLSelectElement;
    await user.selectOptions(within(dialog).getByLabelText('Kind-Objektart'), 'kontrolle');
    expect(geometry.value).toBe('inherit');
    expect(geometry.disabled).toBe(false);
    expect([...geometry.options].map((o) => o.text)).toEqual([
      'Vom Eltern-Objekt übernehmen',
      'Keine eigene Geometrie',
    ]);
    await user.selectOptions(geometry, 'none');
    expect(within(dialog).getByText(/haben keine Position/)).toBeTruthy();
  });

  it('a child type with its own geometry shows zeichnen, disabled, with a hint', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await user.click(screen.getByRole('button', { name: 'Beziehung erstellen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beziehung erstellen' });
    await user.type(within(dialog).getByLabelText('Name'), 'Maßnahmen');
    await user.selectOptions(within(dialog).getByLabelText('Eltern-Objektart'), 'baum');
    await user.selectOptions(within(dialog).getByLabelText('Kind-Objektart'), 'massnahme');
    const geometry = within(dialog).getByLabelText('Geometrie beim Erstellen') as HTMLSelectElement;
    expect(geometry.value).toBe('draw');
    expect(geometry.disabled).toBe(true);
    expect(within(dialog).getByText(/hat eine eigene Position/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Erstellen' }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ geometry: 'draw' })),
    );
  });

  it('each mode is sent as chosen and read back selected when editing', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    const row = document.querySelector('[data-relation="baum.kontrollen"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Beziehung bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beziehung bearbeiten' });
    const geometry = within(dialog).getByLabelText('Geometrie beim Erstellen') as HTMLSelectElement;
    expect(geometry.value).toBe('inherit');
    await user.selectOptions(geometry, 'none');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        'baum.kontrollen',
        expect.objectContaining({ geometry: 'none' }),
      ),
    );
    cleanup();
    mount();
    const own = document.querySelector('[data-relation="baum.massnahme"]') as HTMLElement;
    await user.click(within(own).getByRole('button', { name: 'Beziehung bearbeiten' }));
    const d2 = await screen.findByRole('dialog', { name: 'Beziehung bearbeiten' });
    expect((within(d2).getByLabelText('Geometrie beim Erstellen') as HTMLSelectElement).value).toBe('draw');
  });

  it.each([
    ['de', 'Beziehung bearbeiten', /hat inzwischen eine eigene Position/],
    ['en', 'Edit relation', /now has a position of its own/],
  ] as const)('shows the engine problem on the select (%s)', async (lang, editName, text) => {
    overwriteGetLocale(() => lang);
    const user = userEvent.setup();
    const broken = {
      ...(DATA.relations[0] as RelationRowData),
      geometry: 'inherit',
      childHasGeometry: true,
      geometryProblem: true,
    };
    render(RelationsPage, {
      data: {
        ...DATA,
        relations: [broken],
        types: TYPES.map((t) => (t.key === 'kontrolle' ? { ...t, hasGeometry: true } : t)),
      },
      locale: lang,
      api: fakeApi(),
      reload: vi.fn(() => Promise.resolve()),
    });
    const row = document.querySelector('[data-relation="baum.kontrollen"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: editName }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(text)).toBeTruthy();
    // the way out is offered: zeichnen
    const geometry = within(dialog).getByLabelText(/Geometr/) as HTMLSelectElement;
    expect([...geometry.options].map((o) => o.value)).toEqual(['inherit', 'draw']);
    expect(geometry.disabled).toBe(false);
  });

  it('creates a relation: name, parent, child, multiplicity; the publish bar is told and the list reloads', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    await user.click(screen.getByRole('button', { name: 'Beziehung erstellen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beziehung erstellen' });
    await user.type(within(dialog).getByLabelText('Name'), 'Inspektionen');
    await user.selectOptions(within(dialog).getByLabelText('Eltern-Objektart'), 'baum');
    await user.selectOptions(within(dialog).getByLabelText('Kind-Objektart'), 'massnahme');
    await user.selectOptions(within(dialog).getByLabelText('Multiplizität'), 'one');
    await user.click(within(dialog).getByRole('button', { name: 'Erstellen' }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        name: 'Inspektionen',
        parent: 'baum',
        child: 'massnahme',
        cardinality: 'one',
        attachment: 'enforced',
        onDelete: 'nullify',
        geometry: 'draw',
      }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Beziehung erstellen' })).toBeNull());
  });

  it('does not save the same type on both sides (v3) and says why', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await user.click(screen.getByRole('button', { name: 'Beziehung erstellen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beziehung erstellen' });
    await user.type(within(dialog).getByLabelText('Name'), 'x');
    await user.selectOptions(within(dialog).getByLabelText('Eltern-Objektart'), 'baum');
    await user.selectOptions(within(dialog).getByLabelText('Kind-Objektart'), 'baum');
    expect(within(dialog).getByText('Eltern- und Kind-Objektart müssen unterschiedlich sein')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Erstellen' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(api.create).not.toHaveBeenCalled();
  });

  it('a refusal of the project file stays in the dialog and keeps what was typed', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      update: vi.fn(() => Promise.resolve({ ok: false as const, message: 'Die Änderung ist nicht möglich' })),
    });
    mount({ api });
    const row = document.querySelector('[data-relation="baum.kontrollen"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Beziehung bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beziehung bearbeiten' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Kontrollen');
    expect((within(dialog).getByLabelText('Multiplizität') as HTMLSelectElement).value).toBe('many');
    expect((within(dialog).getByLabelText('Anbindung') as HTMLSelectElement).value).toBe('enforced');
    expect(
      (within(dialog).getByLabelText('Wenn das Eltern-Objekt gelöscht wird') as HTMLSelectElement).value,
    ).toBe('cascade');
    await user.selectOptions(within(dialog).getByLabelText('Multiplizität'), 'one');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByTestId('relation-refusal')).toBeTruthy();
    expect(within(dialog).getByText('Die Änderung ist nicht möglich')).toBeTruthy();
    expect((within(dialog).getByLabelText('Multiplizität') as HTMLSelectElement).value).toBe('one');
  });

  it('editing sends the chosen options with the rest, and the help line follows the choice', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    const row = document.querySelector('[data-relation="baum.kontrollen"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Beziehung bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beziehung bearbeiten' });
    await user.selectOptions(within(dialog).getByLabelText('Wenn das Eltern-Objekt gelöscht wird'), 'block');
    expect(within(dialog).getByText(/nur verfügbar, solange es keine Kinder gibt/)).toBeTruthy();
    await user.selectOptions(within(dialog).getByLabelText('Anbindung'), 'optional');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        'baum.kontrollen',
        expect.objectContaining({ attachment: 'optional', onDelete: 'block', cardinality: 'many' }),
      ),
    );
  });

  it('delete asks first, names how many features hold the relation and what still uses it, then deletes', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      preview: vi.fn(() =>
        ok({ uses: [{ path: 'tasks.x', message: 'Das Feld fehlt' }], child: 'kontrolle', refKey: 'baum' }),
      ),
      holding: vi.fn(() => Promise.resolve(12)),
    });
    const { reload } = mount({ api });
    const row = document.querySelector('[data-relation="baum.kontrollen"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Beziehung löschen' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(api.holding).toHaveBeenCalledWith('kontrolle', 'baum');
    expect(await within(confirm).findByTestId('delete-features')).toHaveProperty(
      'textContent',
      expect.stringContaining('12'),
    );
    expect(within(confirm).getByTestId('delete-uses').textContent).toContain('Das Feld fehlt');
    await user.click(within(confirm).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('baum.kontrollen'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });
});
