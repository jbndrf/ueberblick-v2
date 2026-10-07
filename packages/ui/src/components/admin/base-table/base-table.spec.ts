// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../../ui/jsdom-shims.testing';
import BaseTable from './base-table.svelte';
import { axeViolations } from '../../../testing/axe';
import type { TableColumn, TableRow } from './types';

const columns: TableColumn[] = [
  { key: 'name', label: 'Name', kind: 'text', editable: true },
  { key: 'role', label: 'Role', kind: 'text' },
  { key: 'age', label: 'Age', kind: 'number', editable: true },
];
const rows: TableRow[] = [
  { id: 'a', name: 'Anna', role: 'admin', age: 31 },
  { id: 'b', name: 'Bernd', role: 'user', age: 25 },
  { id: 'c', name: 'Clara', role: 'user', age: 40 },
  { id: 'd', name: 'Dirk', role: 'admin', age: 19 },
];

// Open overlays count as hidden to testing-library in jsdom (no layout, floating-ui parks them off-screen), and the
// accessible name of a hidden node comes out empty: find overlay items by role and visible text or aria-label.
async function overlayItem(role: string, name: string | RegExp): Promise<HTMLElement> {
  const matches = (s: string | null | undefined) =>
    name instanceof RegExp ? name.test(s ?? '') : s?.trim() === name;
  return waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(`[role=${role}]`)].find(
      (e) => matches(e.textContent) || matches(e.getAttribute('aria-label')),
    );
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });
}

// jsdom has no layout: give the scroll area the size a phone-sized panel would have, so the virtualiser has a window.
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

/** Names in the body, in display order (the add row and header are not data rows). */
function names(): string[] {
  return screen
    .queryAllByRole('row')
    .filter((r) => r.hasAttribute('data-row-id'))
    .map((r) => within(r).getAllByRole('cell').at(0)?.textContent?.trim() ?? '');
}

describe('BaseTable in memory', () => {
  it('search narrows rows', async () => {
    const user = userEvent.setup();
    render(BaseTable, { rows, columns });
    expect(names()).toEqual(['Anna', 'Bernd', 'Clara', 'Dirk']);
    await user.type(screen.getByRole('searchbox'), 'rn');
    expect(names()).toEqual(['Bernd']);
  });

  it('header click sorts asc, then desc, then off', async () => {
    const user = userEvent.setup();
    render(BaseTable, { rows, columns });
    const ageSort = screen.getByRole('button', { name: 'Age' });
    await user.click(ageSort);
    expect(names()).toEqual(['Dirk', 'Bernd', 'Anna', 'Clara']);
    await user.click(ageSort);
    expect(names()).toEqual(['Clara', 'Anna', 'Bernd', 'Dirk']);
    await user.click(ageSort);
    expect(names()).toEqual(['Anna', 'Bernd', 'Clara', 'Dirk']);
  });

  it('filters a column by its distinct values and clears the filter', async () => {
    const user = userEvent.setup();
    render(BaseTable, { rows, columns });
    await user.click(screen.getByRole('button', { name: 'Filter Role' }));
    await user.click(await overlayItem('option', /admin/));
    expect(names()).toEqual(['Anna', 'Dirk']);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(names()).toEqual(['Anna', 'Bernd', 'Clara', 'Dirk']);
  });

  it('Edit mode makes editable cells inputs and calls onEdit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(BaseTable, { rows, columns, onEdit, showEditMode: true });
    expect(screen.queryByRole('button', { name: 'Anna' })).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await user.click(screen.getByRole('button', { name: 'Anna' }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Anja{Enter}');
    expect(onEdit).toHaveBeenCalledWith('a', 'name', 'Anja');
    // a non-editable column stays text
    expect(screen.queryByRole('button', { name: 'admin' })).toBeNull();
  });

  it('the inline add row calls onAdd with the typed values', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(BaseTable, { rows, columns, onAdd, addRow: { requiredKeys: ['name'], excludedKeys: ['role'] } });
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
    const addRow = document.querySelector('[data-add-row]') as HTMLElement;
    await user.click(within(addRow).getAllByRole('button')[0] as HTMLElement);
    await user.type(within(addRow).getByRole('textbox'), 'Emil{Enter}');
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Emil' }));
  });

  it('the add row refuses while a required value is missing', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(BaseTable, { rows, columns, onAdd, addRow: { requiredKeys: ['name'] } });
    const addRow = document.querySelector('[data-add-row]') as HTMLElement;
    await user.click(within(addRow).getAllByRole('button')[2] as HTMLElement);
    await user.type(within(addRow).getByRole('spinbutton'), '5{Enter}');
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('shift-click selects a range', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(BaseTable, { rows, columns, selectable: true, onSelectionChange });
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await user.click(boxes[0] as HTMLElement);
    await user.keyboard('{Shift>}');
    await user.click(boxes[3] as HTMLElement);
    await user.keyboard('{/Shift}');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a', 'b', 'c', 'd']);
  });

  it('the row menu fires its item, edit and delete', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onEditRow = vi.fn();
    const onDelete = vi.fn();
    render(BaseTable, {
      rows,
      columns,
      onDelete,
      rowMenu: { onEdit: onEditRow, items: [{ label: 'Invite', onSelect }] },
    });
    await user.click(screen.getAllByRole('button', { name: 'Open menu' })[1] as HTMLElement);
    await user.click(await overlayItem('menuitem', 'Invite'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    await user.click(screen.getAllByRole('button', { name: 'Open menu' })[0] as HTMLElement);
    await user.click(await overlayItem('menuitem', 'Edit'));
    expect(onEditRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    await user.click(screen.getAllByRole('button', { name: 'Open menu' })[2] as HTMLElement);
    await user.click(await overlayItem('menuitem', 'Delete'));
    expect(onDelete).toHaveBeenCalledWith(['c']);
  });

  it('shows the empty message', () => {
    render(BaseTable, { rows: [], columns });
    expect(screen.getByText('No data found')).toBeTruthy();
  });
});

describe('BaseTable in query mode', () => {
  it('does not filter or sort itself and reports the state', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    render(BaseTable, { rows, columns, onQueryChange });
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(names()).toEqual(['Anna', 'Bernd', 'Clara', 'Dirk']);
    await waitFor(() =>
      expect(onQueryChange).toHaveBeenLastCalledWith({ search: 'zzz', sort: null, filters: {}, page: 0 }),
    );
    await user.click(screen.getByRole('button', { name: 'Age' }));
    expect(names()).toEqual(['Anna', 'Bernd', 'Clara', 'Dirk']);
    await waitFor(() =>
      expect(onQueryChange).toHaveBeenLastCalledWith({
        search: 'zzz',
        sort: { key: 'age', direction: 'asc' },
        filters: {},
        page: 0,
      }),
    );
  });
});

describe('BaseTable with 10 000 rows', () => {
  const many: TableRow[] = Array.from({ length: 10_000 }, (_, i) => ({
    id: `r${i}`,
    name: `Name ${i}`,
    role: i % 2 ? 'user' : 'admin',
    age: i % 90,
  }));

  it('renders at most 60 row elements, and a scroll moves the window', async () => {
    const t0 = performance.now();
    const { container } = render(BaseTable, { rows: many, columns });
    const first = performance.now() - t0;
    const rowEls = () => container.querySelectorAll('tbody tr[data-row-id]');
    expect(rowEls().length).toBeGreaterThan(0);
    expect(rowEls().length).toBeLessThanOrEqual(60);
    const before = rowEls()[0]?.getAttribute('data-row-id');
    const scroller = container.querySelector('[data-scroll]') as HTMLElement;
    const t1 = performance.now();
    scroller.scrollTop = 49 * 5000;
    scroller.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(rowEls()[0]?.getAttribute('data-row-id')).not.toBe(before));
    const scroll = performance.now() - t1;
    expect(rowEls().length).toBeLessThanOrEqual(60);
    // the header lives in the same scroll container and sticks to its top
    expect(scroller.querySelector('thead')?.className).toContain('sticky');
    console.info(
      `BaseTable 10k rows: first render ${first.toFixed(0)} ms, scroll update ${scroll.toFixed(0)} ms`,
    );
  });
});

describe('BaseTable accessibility', () => {
  it('a sample table has no axe violations', async () => {
    const { container } = render(BaseTable, {
      rows,
      columns,
      selectable: true,
      showEditMode: true,
      rowMenu: { onEdit: () => {} },
      addRow: {},
      onAdd: () => {},
    });
    expect(await axeViolations(container)).toEqual([]);
  });
});
