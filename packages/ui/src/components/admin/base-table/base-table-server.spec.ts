// @vitest-environment jsdom
// WP-347: the server-side list (query mode) needs three things from the table: the values of a column's filter list come
// from the server, the next page is asked for when the scroll reaches the end, and a pending load is shown.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../../ui/jsdom-shims.testing';
import BaseTable from './base-table.svelte';
import type { TableColumn, TableRow } from './types';

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

const columns: TableColumn[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'stage', label: 'Stufe', kind: 'text', emptyLabel: 'ohne Stufe' },
];
const rows: TableRow[] = [
  { id: 'a', name: 'Anna', stage: 'x' },
  { id: 'b', name: 'Bernd', stage: 'y' },
];

async function overlayItem(name: RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[role=option]')].find((e) =>
      name.test(e.textContent ?? ''),
    );
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });
}

describe('BaseTable filter values from the server', () => {
  it('asks for the column when its filter list opens and shows labels with counts', async () => {
    const user = userEvent.setup();
    const filterValues = vi.fn(async () => [
      { value: 'x', label: 'Phase X', count: 1200 },
      { value: '__empty__', label: '', count: 3 },
    ]);
    render(BaseTable, { rows, columns, onQueryChange: vi.fn(), filterValues });
    expect(filterValues).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Filter Stufe' }));
    expect(filterValues).toHaveBeenCalledWith('stage');
    expect((await overlayItem(/Phase X/)).textContent).toContain('(1200)');
    expect((await overlayItem(/ohne Stufe/)).textContent).toContain('(3)');
  });

  it('a ticked value goes to the parent as a filter on the raw value', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const filterValues = async () => [{ value: 'x', label: 'Phase X', count: 2 }];
    render(BaseTable, { rows, columns, onQueryChange, filterValues });
    await user.click(screen.getByRole('button', { name: 'Filter Stufe' }));
    await user.click(await overlayItem(/Phase X/));
    await waitFor(() =>
      expect(onQueryChange).toHaveBeenLastCalledWith({
        search: '',
        sort: null,
        filters: { stage: ['x'] },
        page: 0,
      }),
    );
    // the table did not filter its rows itself
    expect(screen.getByText('Bernd')).toBeTruthy();
  });

  it('shows a spinner while the values load', async () => {
    const user = userEvent.setup();
    let release: (v: { value: string; label: string; count: number }[]) => void = () => undefined;
    const filterValues = () =>
      new Promise<{ value: string; label: string; count: number }[]>((r) => (release = r));
    render(BaseTable, { rows, columns, onQueryChange: vi.fn(), filterValues, loadingLabel: 'Lädt …' });
    await user.click(screen.getByRole('button', { name: 'Filter Stufe' }));
    await waitFor(() =>
      expect(document.querySelector('[data-slot="command-list"] [role=status]')).toBeTruthy(),
    );
    release([{ value: 'x', label: 'Phase X', count: 1 }]);
    await overlayItem(/Phase X/);
    expect(document.querySelector('[data-slot="command-list"] [role=status]')).toBeNull();
  });
});

describe('BaseTable paging by scroll', () => {
  it('calls onReachEnd when the last rows are in view, not while rows are far off', async () => {
    const onReachEnd = vi.fn();
    render(BaseTable, { rows, columns, onQueryChange: vi.fn(), onReachEnd });
    await waitFor(() => expect(onReachEnd).toHaveBeenCalled());

    onReachEnd.mockClear();
    const many: TableRow[] = Array.from({ length: 5000 }, (_, i) => ({
      id: `r${i}`,
      name: `N${i}`,
      stage: 'x',
    }));
    render(BaseTable, { rows: many, columns, onQueryChange: vi.fn(), onReachEnd });
    await new Promise((r) => setTimeout(r, 50));
    expect(onReachEnd).not.toHaveBeenCalled();
  });

  it('shows a spinner row at the end while the next page loads', () => {
    render(BaseTable, { rows, columns, onQueryChange: vi.fn(), loadingMore: true, loadingLabel: 'Lädt …' });
    expect(screen.getByRole('status', { name: 'Lädt …' })).toBeTruthy();
  });
});

describe('BaseTable first load', () => {
  it('shows a spinner instead of the empty message while the first page loads', () => {
    render(BaseTable, {
      rows: [],
      columns,
      onQueryChange: vi.fn(),
      loading: true,
      loadingLabel: 'Lädt …',
      emptyMessage: 'Noch keine Objekte',
    });
    expect(screen.getByRole('status', { name: 'Lädt …' })).toBeTruthy();
    expect(screen.queryByText('Noch keine Objekte')).toBeNull();
  });

  it('shows the empty message once loaded', () => {
    render(BaseTable, { rows: [], columns, onQueryChange: vi.fn(), emptyMessage: 'Noch keine Objekte' });
    expect(screen.getByText('Noch keine Objekte')).toBeTruthy();
  });
});

describe('BaseTable initial query', () => {
  it('starts from the given search, sort and filters and reports them in its first query (WP-362)', () => {
    const onQueryChange = vi.fn();
    render(BaseTable, {
      rows,
      columns,
      onQueryChange,
      initialQuery: { search: 'An', sort: { key: 'name', direction: 'desc' }, filters: { stage: ['x'] } },
    });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('An');
    expect(onQueryChange).toHaveBeenCalledWith({
      search: 'An',
      sort: { key: 'name', direction: 'desc' },
      filters: { stage: ['x'] },
      page: 0,
    });
  });
});
