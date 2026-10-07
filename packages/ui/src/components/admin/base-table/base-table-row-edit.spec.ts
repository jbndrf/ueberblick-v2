// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../../ui/jsdom-shims.testing';
import { toast } from 'svelte-sonner';
import { overwriteGetLocale } from '../../../paraglide/runtime.js';
import BaseTable from './base-table.svelte';
import { RowRefusal } from './row-edits.svelte';
import type { TableColumn, TableRow } from './types';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: {} }));

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

// WP-370 (owner answer A1): Bearbeitungsmodus collects the edits of a row; the row's check saves them as one.
const columns: TableColumn[] = [
  { key: 'name', label: 'Name', kind: 'text', editable: true },
  { key: 'age', label: 'Age', kind: 'number', editable: true },
  { key: 'role', label: 'Role', kind: 'text' },
];
const rows: TableRow[] = [
  { id: 'a', name: 'Anna', role: 'admin', age: 31 },
  { id: 'b', name: 'Bernd', role: 'user', age: 25 },
];

afterEach(() => {
  vi.clearAllMocks();
  overwriteGetLocale(() => 'en');
});

const rowOf = (id: string): HTMLElement => document.querySelector(`[data-row-id="${id}"]`) as HTMLElement;

async function editName(user: ReturnType<typeof userEvent.setup>, from: string, to: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: from }));
  const input = screen.getByRole('textbox');
  await user.clear(input);
  await user.type(input, `${to}{Enter}`);
}

describe('row edits (onRowSave)', () => {
  it('collects the cell edits of a row and saves them with one call on the check', async () => {
    const user = userEvent.setup();
    const onRowSave = vi.fn();
    render(BaseTable, { rows, columns, onRowSave, showEditMode: true });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await editName(user, 'Anna', 'Anja');
    await user.click(screen.getByRole('button', { name: '31' }));
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '32{Enter}');
    // nothing is saved yet, nothing is announced as saved, the edits show in the row
    expect(onRowSave).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(rowOf('a')).getByRole('button', { name: 'Anja' })).toBeTruthy();
    await user.click(within(rowOf('a')).getByRole('button', { name: 'Save the changes of this row' }));
    expect(onRowSave).toHaveBeenCalledTimes(1);
    expect(onRowSave).toHaveBeenCalledWith('a', { name: 'Anja', age: 32 });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(within(rowOf('a')).queryByRole('button', { name: 'Save the changes of this row' })).toBeNull();
  });

  it('the x discards the edits; an edit back to the original ends the row edit', async () => {
    const user = userEvent.setup();
    const onRowSave = vi.fn();
    render(BaseTable, { rows, columns, onRowSave, showEditMode: true });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await editName(user, 'Anna', 'Anja');
    await user.click(within(rowOf('a')).getByRole('button', { name: 'Discard the changes of this row' }));
    expect(screen.getByRole('button', { name: 'Anna' })).toBeTruthy();
    await editName(user, 'Anna', 'Anja');
    await editName(user, 'Anja', 'Anna');
    expect(within(rowOf('a')).queryByRole('button', { name: 'Save the changes of this row' })).toBeNull();
    expect(onRowSave).not.toHaveBeenCalled();
  });

  it('a refusal marks the named cell, keeps the edits, and a new edit of that cell clears the mark', async () => {
    const user = userEvent.setup();
    const onRowSave = vi
      .fn()
      .mockRejectedValueOnce(new RowRefusal('Age: too old', { age: 'too old' }))
      .mockResolvedValue(undefined);
    render(BaseTable, { rows, columns, onRowSave, showEditMode: true });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await editName(user, 'Anna', 'Anja');
    await user.click(screen.getByRole('button', { name: '31' }));
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '200{Enter}');
    await user.click(within(rowOf('a')).getByRole('button', { name: 'Save the changes of this row' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Age: too old'));
    const bad = rowOf('a').querySelector('[aria-invalid="true"]') as HTMLElement;
    expect(bad.getAttribute('title')).toBe('too old');
    expect(within(bad).getByRole('button', { name: '200' })).toBeTruthy();
    // the other edit stays
    expect(within(rowOf('a')).getByRole('button', { name: 'Anja' })).toBeTruthy();
    await user.click(within(bad).getByRole('button', { name: '200' }));
    const again = screen.getByRole('spinbutton');
    await user.clear(again);
    await user.type(again, '33{Enter}');
    expect(rowOf('a').querySelector('[aria-invalid="true"]')).toBeNull();
    await user.click(within(rowOf('a')).getByRole('button', { name: 'Save the changes of this row' }));
    expect(onRowSave).toHaveBeenLastCalledWith('a', { name: 'Anja', age: 33 });
  });

  it('keys: after a cell edit the row has the focus; Enter saves the row, Escape discards it', async () => {
    const user = userEvent.setup();
    const onRowSave = vi.fn();
    render(BaseTable, { rows, columns, onRowSave, showEditMode: true });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await editName(user, 'Anna', 'Anja');
    await waitFor(() => expect(document.activeElement).toBe(rowOf('a')));
    await user.keyboard('{Enter}');
    expect(onRowSave).toHaveBeenCalledWith('a', { name: 'Anja' });
    await waitFor(() =>
      expect(within(rowOf('a')).queryByRole('button', { name: /Save the changes/ })).toBeNull(),
    );

    await editName(user, 'Bernd', 'Ben');
    await waitFor(() => expect(document.activeElement).toBe(rowOf('b')));
    await user.keyboard('{Escape}');
    expect(within(rowOf('b')).getByText('Bernd')).toBeTruthy();
    expect(onRowSave).toHaveBeenCalledTimes(1);
  });

  it('the check and x are at least 44 px targets', async () => {
    const user = userEvent.setup();
    render(BaseTable, { rows, columns, onRowSave: vi.fn(), showEditMode: true });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await editName(user, 'Anna', 'Anja');
    const buttons = rowOf('a').querySelectorAll('[data-row-edit-actions] button');
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b.className).toMatch(/\bh-11\b.*\bw-11\b|\bw-11\b.*\bh-11\b/);
  });

  it('leaving Bearbeitungsmodus drops unsaved edits', async () => {
    const user = userEvent.setup();
    render(BaseTable, { rows, columns, onRowSave: vi.fn(), showEditMode: true });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await editName(user, 'Anna', 'Anja');
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    expect(screen.queryByText('Anja')).toBeNull();
    expect(screen.getByText('Anna')).toBeTruthy();
  });

  it('without onRowSave keys behave as before: the row takes no focus, Enter and Escape on it do nothing, the cell saves at once', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(BaseTable, { rows, columns, onEdit, showEditMode: true });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await editName(user, 'Anna', 'Anja');
    expect(onEdit).toHaveBeenCalledWith('a', 'name', 'Anja');
    expect(rowOf('a').hasAttribute('tabindex')).toBe(false);
    rowOf('a').focus();
    await user.keyboard('{Enter}{Escape}');
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(rowOf('a').querySelector('[data-row-edit-actions]')).toBeNull();
  });

  it('a live column (the Status switch) still saves at once through onEdit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(BaseTable, {
      rows: [{ id: 'a', on: true }],
      columns: [{ key: 'on', label: 'On', kind: 'boolean', editable: true, live: true }],
      onEdit,
      onRowSave: vi.fn(),
    });
    await user.click(screen.getByRole('switch'));
    expect(onEdit).toHaveBeenCalledWith('a', 'on', false);
  });
});
