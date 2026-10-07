// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import DataTable from './DataTable.svelte';
import DataHeader from './DataHeader.svelte';

// jsdom has no layout: give the table's scroll area the size of a panel, so the virtualiser has a window.
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
  label: { de: 'Baum' },
  geometry: 'geometrie',
  process: { property: 'stage', start: 'erfasst', end: ['gefaellt'] },
  properties: {
    geometrie: { type: 'geometry', geometry_type: 'point' },
    stage: { type: 'select', options: { erfasst: { de: 'Erfasst' }, gefaellt: { de: 'Gefällt' } } },
    befund: { type: 'text', label: { de: 'Befund' } },
    hoehe_m: { type: 'number', label: { de: 'Höhe (m)' } },
  },
} as never;

const row = (n: number, over: Record<string, unknown> = {}) => ({
  $id: `f${n}`,
  $lifecycle: 'active',
  $created_by: 'u1',
  $created_at: '2026-03-04T10:00:00.000Z',
  $changed_at: '2026-03-04T10:00:00.000Z',
  lon: 7.1,
  lat: 50.2,
  stage: 'erfasst',
  befund: `Pilz ${n}`,
  hoehe_m: 12.5,
  ...over,
});

const requests: URL[] = [];
function respond(url: URL): unknown {
  if (url.pathname.endsWith('/distinct')) {
    return url.searchParams.get('column') === '$lifecycle'
      ? [
          { value: 'active', count: 5 },
          { value: 'deleted', count: 2 },
        ]
      : [];
  }
  if (url.searchParams.get('cursor') === 'C1') return { rows: [row(3)], next: null, total: 3 };
  return { rows: [row(1), row(2, { stage: 'gefaellt', $lifecycle: 'completed' })], next: 'C1', total: 3 };
}
beforeEach(() => {
  // The table keeps its query in sessionStorage (table-state.ts): every test starts from an empty one.
  sessionStorage.clear();
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://x');
      requests.push(url);
      return { ok: true, status: 200, json: async () => respond(url) } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const props = {
  locale: 'de' as const,
  project: 'musterstadt',
  typeKey: 'baum',
  type,
  names: { u1: 'Anna Beispiel' },
};
const lastList = () => requests.filter((u) => u.pathname.endsWith('/features')).at(-1) as URL;

describe('the data table of one Objektart', () => {
  it('shows v3 columns and the rows of the API: names, lifecycle and stage as labels', async () => {
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(heads.slice(1)).toEqual([
      'Status',
      'Stufe',
      'Erstellt von',
      'Standort',
      'Befund',
      'Höhe (m)',
      'Erstellt',
      'Aktionen',
    ]); // the first is the selection checkbox, the last holds the row's check and cancel in Bearbeitungsmodus
    const first = screen
      .getAllByRole('row')
      .find((r) => r.getAttribute('data-row-id') === 'f1') as HTMLElement;
    expect(within(first).getByText('aktiv')).toBeTruthy();
    expect(within(first).getByText('Erfasst')).toBeTruthy();
    expect(within(first).getByText('Anna Beispiel')).toBeTruthy();
    expect(within(first).getByText('50.2000, 7.1000')).toBeTruthy();
    const second = screen
      .getAllByRole('row')
      .find((r) => r.getAttribute('data-row-id') === 'f2') as HTMLElement;
    expect(within(second).getByText('abgeschlossen')).toBeTruthy();
    expect(within(second).getByText('Gefällt')).toBeTruthy();
  });

  it('asks for the first page without filters, so deleted ones stay hidden by default', async () => {
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    const first = requests[0] as URL;
    expect(first.pathname).toBe('/api/admin/p/musterstadt/features');
    expect(first.searchParams.get('type')).toBe('baum');
    expect(first.searchParams.has('lifecycle')).toBe(false);
  });

  it('loads the next page by cursor and appends it', async () => {
    render(DataTable, props);
    await screen.findByText('Pilz 3'); // the short list is already at its end: the next page follows
    expect(requests.some((u) => u.searchParams.get('cursor') === 'C1')).toBe(true);
    expect(screen.getByText('Pilz 1')).toBeTruthy();
  });

  it('search goes to the API', async () => {
    const user = userEvent.setup();
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    await user.type(screen.getByRole('searchbox'), 'Ast');
    await waitFor(() => expect(lastList().searchParams.get('q')).toBe('Ast'));
  });

  it('a click on a header sorts on the server', async () => {
    const user = userEvent.setup();
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    await user.click(screen.getByRole('button', { name: 'Befund' }));
    await waitFor(() => {
      expect(lastList().searchParams.get('sort')).toBe('befund');
      expect(lastList().searchParams.get('dir')).toBe('asc');
    });
  });

  it('a column filter lists the server values with counts and filters on the raw value', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    await user.click(screen.getByRole('button', { name: 'Status filtern' }));
    const item = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[role=option]')].find((e) =>
        /gelöscht/.test(e.textContent ?? ''),
      );
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(item.textContent).toContain('(2)');
    await user.click(item);
    await waitFor(() => {
      expect(lastList().searchParams.get('filter.$lifecycle')).toBe('deleted');
      expect(lastList().searchParams.get('lifecycle')).toBe('active,completed,archived,deleted');
    });
  });

  it('a click on a row opens that Objekt (v3 `onRowClick`, S3-21)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onOpen = vi.fn();
    render(DataTable, { ...props, onOpen });
    await screen.findByText('Pilz 1');
    const first = screen
      .getAllByRole('row')
      .find((r) => r.getAttribute('data-row-id') === 'f1') as HTMLElement;
    await user.click(within(first).getByText('Pilz 1'));
    expect(onOpen).toHaveBeenCalledWith('f1');
  });

  it('starts from the query the table was left with, so "Zurück" lands on the same table (S3-21)', async () => {
    sessionStorage.setItem(
      'ueberblick:admin-data-query:musterstadt:baum',
      JSON.stringify({ search: 'Ast', sort: { key: 'befund', direction: 'desc' }, filters: {} }),
    );
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    const first = requests.find((u) => u.pathname.endsWith('/features')) as URL;
    expect(first.searchParams.get('q')).toBe('Ast');
    expect(first.searchParams.get('sort')).toBe('befund');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Ast');
  });

  it('keeps the query it is given for the next visit', async () => {
    const user = userEvent.setup();
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    await user.type(screen.getByRole('searchbox'), 'Pilz');
    await waitFor(() =>
      expect(
        JSON.parse(sessionStorage.getItem('ueberblick:admin-data-query:musterstadt:baum') ?? '{}').search,
      ).toBe('Pilz'),
    );
  });

  it('says so when there are no Objekte', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ rows: [], next: null, total: 0 }) }) as Response),
    );
    render(DataTable, props);
    expect(await screen.findByText('Noch keine Objekte vorhanden')).toBeTruthy();
    expect(screen.getByText('Objekte werden von Teilnehmenden über die App erstellt')).toBeTruthy();
  });
});

describe('the page header', () => {
  it('shows the name and the Builder button of the Objektart (v3: Hammer, "Builder")', async () => {
    const onRefresh = vi.fn();
    const onImport = vi.fn();
    render(DataHeader, {
      name: 'Baum',
      description: 'Alle Bäume',
      builderHref: '/admin/projects/musterstadt/types/baum/builder',
      builderLabel: 'Builder',
      refreshLabel: 'Aktualisieren',
      onRefresh,
      importLabel: 'CSV importieren',
      onImport,
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Baum' })).toBeTruthy();
    expect(screen.getByText('Alle Bäume')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Builder' }).getAttribute('href')).toBe(
      '/admin/projects/musterstadt/types/baum/builder',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    expect(onRefresh).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'CSV importieren' }));
    expect(onImport).toHaveBeenCalled();
  });
});
