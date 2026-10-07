// @vitest-environment jsdom
// WP-419 (S3-19 part b): the ⋮ menu of the data page header and its two dialogs. The components send calls; the route
// writes the draft (`menu.server.spec.ts`, builder `types.spec.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import DataHeader from './DataHeader.svelte';
import DeleteTypeDialog from './DeleteTypeDialog.svelte';
import ImportTypeDialog from './ImportTypeDialog.svelte';
import type { MenuApi } from './menu-api';
import type { DeleteCounts, MenuCall, MenuResult } from './menu-types';

afterEach(() => {
  cleanup();
  document.body.removeAttribute('style');
});

const api = (answer: (c: MenuCall) => MenuResult) => {
  const call = vi.fn(async (c: MenuCall) => answer(c));
  return { api: { call } satisfies MenuApi, call };
};
const counts = (over: Partial<DeleteCounts> = {}): DeleteCounts => ({
  stages: 4,
  tasks: 2,
  rules: 1,
  views: 0,
  objects: 0,
  values: 0,
  ...over,
});

const mountHeader = (menu?: {
  busy: boolean;
  onDuplicate: () => void;
  onImport: () => void;
  onDelete: () => void;
}) =>
  render(DataHeader, {
    name: 'Baum',
    builderHref: '/b',
    builderLabel: 'Builder',
    refreshLabel: 'Aktualisieren',
    onRefresh: vi.fn(),
    importLabel: 'CSV importieren',
    onImport: vi.fn(),
    locale: 'de',
    ...(menu === undefined ? {} : { menu }),
  });

describe('the ⋮ menu', () => {
  const actions = () => ({ busy: false, onDuplicate: vi.fn(), onImport: vi.fn(), onDelete: vi.fn() });

  it('is "Weitere Aktionen" and Duplizieren calls its action', async () => {
    const menu = actions();
    mountHeader(menu);
    expect(screen.getByTestId('data-menu').getAttribute('aria-label')).toBe('Weitere Aktionen');
    await userEvent.click(screen.getByTestId('data-menu'));
    await userEvent.click(await screen.findByTestId('data-menu-duplicate'));
    expect(menu.onDuplicate).toHaveBeenCalledOnce();
  });

  it('Aus Projekt importieren calls its action', async () => {
    const menu = actions();
    mountHeader(menu);
    await userEvent.click(screen.getByTestId('data-menu'));
    await userEvent.click(await screen.findByTestId('data-menu-import'));
    expect(menu.onImport).toHaveBeenCalledOnce();
  });

  it('Objektart löschen (destructive, below a separator) calls its action', async () => {
    const menu = actions();
    mountHeader(menu);
    await userEvent.click(screen.getByTestId('data-menu'));
    const del = await screen.findByTestId('data-menu-delete');
    expect(del.textContent).toContain('Objektart löschen');
    expect(del.className).toContain('text-destructive');
    await userEvent.click(del);
    expect(menu.onDelete).toHaveBeenCalledOnce();
  });

  it('shows no menu while the page has nothing to copy or remove', () => {
    mountHeader();
    expect(screen.queryByTestId('data-menu')).toBeNull();
  });

  it('disables Duplizieren while a copy is being made', async () => {
    mountHeader({ ...actions(), busy: true });
    await userEvent.click(screen.getByTestId('data-menu'));
    expect((await screen.findByTestId('data-menu-duplicate')).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the delete dialog (acceptance 3)', () => {
  const open = (c: DeleteCounts, onRemoved = vi.fn()) => {
    const m = api((call) =>
      call.action === 'counts'
        ? { ok: true, answer: { kind: 'counts', counts: c } }
        : { ok: true, answer: { kind: 'removed', notes: [] } },
    );
    render(DeleteTypeDialog, { open: true, locale: 'de', name: 'Baum', api: m.api, onRemoved });
    return { ...m, onRemoved };
  };

  it('shows the counts, with the data in bold, and says the deletion takes effect with Veröffentlichen', async () => {
    open(counts({ objects: 12, values: 340 }));
    const list = await screen.findByTestId('delete-type-counts');
    expect(list.textContent).toContain('4 Stufen');
    expect(list.textContent).toContain('2 Aufgaben');
    expect(list.textContent).toContain('1 Regeln');
    expect(list.textContent).not.toContain('Ansichten'); // zero counts stay out, as in v3
    expect(list.textContent).toContain('12 Objekte · 340 erfasste Werte');
    expect(document.body.textContent).toContain('Veröffentlichen');
  });

  it('with Objekte the button stays disabled until their number is typed', async () => {
    const { call, onRemoved } = open(counts({ objects: 12 }));
    const submit = await screen.findByTestId('delete-type-submit');
    expect(submit.hasAttribute('disabled')).toBe(true);
    const input = screen.getByTestId('delete-type-confirm');
    await userEvent.type(input, '11');
    expect(submit.hasAttribute('disabled')).toBe(true);
    await userEvent.clear(input);
    await userEvent.type(input, '12');
    expect(submit.hasAttribute('disabled')).toBe(false);
    await userEvent.click(submit);
    await waitFor(() => expect(call).toHaveBeenCalledWith({ action: 'remove' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith([]));
  });

  it('without Objekte there is nothing to type and the button is on at once', async () => {
    open(counts());
    const submit = await screen.findByTestId('delete-type-submit');
    expect(screen.queryByTestId('delete-type-confirm')).toBeNull();
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('says "Keine zugehörigen Daten." for a type with nothing attached', async () => {
    open(counts({ stages: 0, tasks: 0, rules: 0 }));
    await screen.findByText('Keine zugehörigen Daten.');
  });
});

describe('the import dialog (acceptance 2)', () => {
  const sources = [
    { key: 'p2', name: 'Stadtwerke', types: [{ key: 'meldung', label: 'Meldung' }] },
    { key: 'p3', name: 'Leer', types: [] },
  ];
  const open = (onImported = vi.fn()) => {
    const m = api((call) =>
      call.action === 'sources'
        ? { ok: true, answer: { kind: 'sources', sources } }
        : { ok: true, answer: { kind: 'copy', copy: { key: 'meldung_kopie', notes: [] } } },
    );
    render(ImportTypeDialog, { open: true, locale: 'de', api: m.api, onImported });
    return { ...m, onImported };
  };

  it('picks a project, then one of its types, and imports it', async () => {
    const { call, onImported } = open();
    const project = (await screen.findByLabelText('Projekt')) as HTMLSelectElement;
    await waitFor(() => expect(project.options.length).toBe(3));
    const type = screen.getByLabelText('Objektart') as HTMLSelectElement;
    expect(type.disabled).toBe(true);
    const submit = screen.getByTestId('import-type-submit');
    expect(submit.hasAttribute('disabled')).toBe(true);
    await userEvent.selectOptions(project, 'p2');
    expect(type.disabled).toBe(false);
    await userEvent.selectOptions(type, 'meldung');
    await userEvent.click(submit);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith({ action: 'import', project: 'p2', type: 'meldung' }),
    );
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ key: 'meldung_kopie', notes: [] }));
  });

  it('says so when the chosen project has no published type', async () => {
    open();
    const project = (await screen.findByLabelText('Projekt')) as HTMLSelectElement;
    await waitFor(() => expect(project.options.length).toBe(3));
    await userEvent.selectOptions(project, 'p3');
    expect(await screen.findByText('Dieses Projekt hat noch keine veröffentlichte Objektart.')).toBeTruthy();
  });
});
