// @vitest-environment jsdom
// WP-382: the table of a table page. One column per property in the type's order (the first is the Hauptspalte, Q15); a
// cell edit is ONE Admin-Korrektur run, a new row ONE `$create` run, a deleted row ONE `$lifecycle` run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { createTablesApi } from './api';
import TableGrid from './TableGrid.svelte';

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

const type = {
  label: { de: 'Geräte' },
  properties: {
    titel: { type: 'text', label: { de: 'Titel' }, required: true },
    stueck: { type: 'number', label: { de: 'Stück' }, default: 1 },
    aktiv: { type: 'boolean', label: { de: 'Aktiv' } },
    zustaendig: { type: 'role', label: { de: 'Zuständig' } },
  },
} as never;

const row = (over: Record<string, unknown> = {}) => ({
  $id: 'f1',
  $lifecycle: 'active',
  $created_by: 'u1',
  $created_at: '2026-03-04T10:00:00.000Z',
  $changed_at: '2026-03-04T10:00:00.000Z',
  $seq: 4,
  titel: 'Bagger',
  stueck: 2,
  aktiv: true,
  zustaendig: 'bauhof',
  ...over,
});

interface Sent {
  url: URL;
  method: string;
  body?: unknown;
}
const sent: Sent[] = [];
let rows = [row()];

beforeEach(() => {
  sessionStorage.clear();
  sent.length = 0;
  rows = [row()];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://x');
      const method = init?.method ?? 'GET';
      sent.push({ url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (method === 'POST') {
        const body = url.pathname.endsWith('/correct')
          ? { runId: 'r1', seq: 5 }
          : url.pathname.endsWith('/lifecycle')
            ? { runId: 'r2' }
            : { runId: 'r3', id: 'f2' };
        return {
          ok: true,
          status: url.pathname.endsWith('/features') ? 201 : 200,
          json: async () => body,
        } as Response;
      }
      if (url.pathname.endsWith('/distinct'))
        return { ok: true, status: 200, json: async () => [] } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ rows, next: null, total: rows.length }),
      } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mount = (t: unknown = type) =>
  render(TableGrid, {
    locale: 'de' as const,
    project: 'demo',
    table: 'geraete',
    type: t as never,
    names: {},
    roles: [{ key: 'bauhof', label: 'Bauhof' }],
    api: createTablesApi({
      project: 'demo',
      language: 'de',
      fetch: (i, n) => fetch(i, n),
      fallback: 'Fehler',
    }),
    onManageColumns: vi.fn(),
  });
// Open overlays count as hidden to testing-library in jsdom: find a menu item by role and visible text.
const menuItem = (name: string) =>
  waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
      (e) => e.textContent?.trim() === name,
    );
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });
const posts = () => sent.filter((s) => s.method === 'POST');
const rowEl = () =>
  screen.getAllByRole('row').find((r) => r.getAttribute('data-row-id') === 'f1') as HTMLElement;

describe('a table page grid', () => {
  it('shows one column per property in the type order and no system columns', async () => {
    mount();
    await screen.findByText('Bagger');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    const own = heads.filter((h) => ['Titel', 'Stück', 'Aktiv'].includes(h ?? ''));
    expect(own).toEqual(['Titel', 'Stück', 'Aktiv']);
    expect(heads.some((h) => /Status|Erstellt/.test(h ?? ''))).toBe(false);
  });

  it('shows a role column by the role label, not the key (WP-459)', async () => {
    mount();
    await screen.findByText('Bagger');
    expect(within(rowEl()).getByText('Bauhof')).toBeTruthy();
    expect(within(rowEl()).queryByText('bauhof')).toBeNull();
  });

  it('a cell edit in Bearbeitungsmodus is one correction run for the row', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await screen.findByText('Bagger');
    await user.click(screen.getByRole('switch', { name: 'Bearbeitungsmodus' }));
    await user.click(within(rowEl()).getByRole('button', { name: 'Bagger' }));
    const box = screen.getByRole('textbox');
    await user.clear(box);
    await user.type(box, 'Radlader{Enter}');
    expect(posts()).toHaveLength(0);
    await user.click(within(rowEl()).getByRole('button', { name: 'Änderungen dieser Zeile speichern' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.url.pathname).toBe('/api/admin/p/demo/features/f1/correct');
    expect(posts()[0]?.body).toEqual({ values: { titel: 'Radlader' }, expected_seq: 4 });
  });

  it('the add row makes one create run with the typed values and the column defaults, then reads the rows again', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await screen.findByText('Bagger');
    const add = document.querySelector('[data-add-row]') as HTMLElement;
    await user.click(within(add).getAllByRole('button')[0] as HTMLElement);
    await user.type(screen.getByRole('textbox'), 'Kran{Enter}');
    rows = [row(), row({ $id: 'f2', titel: 'Kran' })];
    await user.click(within(add).getByRole('button', { name: 'Zeile hinzufügen' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.url.pathname).toBe('/api/admin/p/demo/features');
    expect(posts()[0]?.body).toEqual({ type: 'geraete', values: { titel: 'Kran', stueck: 1 } });
    await screen.findByText('Kran');
  });

  it('the row menu deletes after the confirm dialog: one lifecycle run with the state deleted', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await screen.findByText('Bagger');
    await user.click(within(rowEl()).getByRole('button', { name: 'Menü öffnen' }));
    await user.click(await menuItem('Löschen'));
    expect(posts()).toHaveLength(0);
    expect(await screen.findByText('Zeile löschen')).toBeTruthy();
    rows = [];
    await user.click(screen.getByTestId('row-delete-confirm'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.url.pathname).toBe('/api/admin/p/demo/features/f1/lifecycle');
    expect(posts()[0]?.body).toEqual({ state: 'deleted' });
  });

  it('cancelling the confirm dialog deletes nothing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await screen.findByText('Bagger');
    await user.click(within(rowEl()).getByRole('button', { name: 'Menü öffnen' }));
    await user.click(await menuItem('Löschen'));
    await user.click(await screen.findByRole('button', { name: 'Abbrechen' }));
    expect(posts()).toHaveLength(0);
  });

  it('a reference column shows the names the page brought (Anzeigefeld), not the ids', async () => {
    const withRef = {
      label: { de: 'Geräte' },
      properties: {
        titel: { type: 'text', label: { de: 'Titel' } },
        lager: { type: 'reference', to: 'lager', label: { de: 'Lager' } },
        teile: { type: 'reference', to: 'lager', cardinality: 'many', label: { de: 'Teile' } },
      },
    };
    rows = [row({ lager: 'l1', teile: ['l1', 'l2'] })];
    const plain = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).getMockImplementation();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://x');
        if (url.pathname.endsWith('/features') && (init?.method ?? 'GET') === 'GET')
          return {
            ok: true,
            status: 200,
            json: async () => ({
              rows,
              next: null,
              total: 1,
              referenceNames: { lager: { l1: 'Halle Nord' }, teile: { l1: 'Halle Nord', l2: 'Depot Süd' } },
            }),
          } as Response;
        return (plain as (i: string, n?: RequestInit) => Promise<Response>)(input, init);
      }),
    );
    mount(withRef);
    await screen.findByText('Bagger');
    expect(screen.getAllByText('Halle Nord').length).toBeGreaterThan(0);
    expect(screen.getByText('Halle Nord, Depot Süd')).toBeTruthy();
    expect(screen.queryByText('l1')).toBeNull();
  });
});
