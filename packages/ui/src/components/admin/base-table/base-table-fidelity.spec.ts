// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import '../../ui/jsdom-shims.testing';
import { toast } from 'svelte-sonner';
import BaseTable from './base-table.svelte';
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

const roles = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor', description: 'Edits features' },
  { value: 'viewer', label: 'Viewer' },
];
const rows: TableRow[] = [
  { id: 'a', name: 'Anna', roles: ['admin'], note: 'line 1\nline 2', status: 'open' },
  { id: 'b', name: 'Bernd', roles: [], note: '', status: 'done' },
  { id: 'c', name: 'Clara', roles: ['editor', 'viewer'], note: '', status: 'open' },
];

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}
const names = () =>
  screen
    .queryAllByRole('row')
    .filter((r) => r.hasAttribute('data-row-id'))
    .map((r) => r.getAttribute('data-row-id') ?? '');

/** An option inside the open picker (other rows show the same names as badges). */
async function pick(label: string): Promise<HTMLElement> {
  return waitFor(() => {
    const layer = document.querySelector<HTMLElement>('[role=listbox], [role=dialog]');
    expect(layer).toBeTruthy();
    return within(layer as HTMLElement).getByText(label);
  });
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

describe.each([
  ['phone 390px', 390],
  ['desktop 1280px', 1280],
])('array cell with MultiSelect at %s', (_n, width) => {
  beforeEach(() => setViewport(width));
  const nameCol: TableColumn = { key: 'name', label: 'Name' };
  const rolesCol: TableColumn = {
    key: 'roles',
    label: 'Roles',
    kind: 'array',
    editable: true,
    options: roles,
    emptyText: 'No roles assigned',
  };
  const columns: TableColumn[] = [nameCol, rolesCol];

  async function startEditing(user: ReturnType<typeof userEvent.setup>, onEdit: () => void) {
    render(BaseTable, { rows, columns, onEdit, showEditMode: true });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    const row = document.querySelector('[data-row-id="a"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Admin' }));
  }

  it('shows emptyText for an empty cell', () => {
    render(BaseTable, { rows, columns });
    expect(screen.getByText('No roles assigned')).toBeTruthy();
  });

  it('open, change, Save writes once with a toast', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    await startEditing(user, onEdit);
    await user.click(screen.getByRole('button', { name: 'Admin' }));
    await user.click(await pick('Editor'));
    expect(onEdit).not.toHaveBeenCalled(); // pending until Save
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenCalledWith('a', 'roles', ['admin', 'editor']);
    expect(toast.success).toHaveBeenCalledTimes(1);
    // back to the badges
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('Cancel discards the pending change', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    await startEditing(user, onEdit);
    await user.click(screen.getByRole('button', { name: /Admin/ }));
    await user.click(await pick('Viewer'));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    const row = document.querySelector('[data-row-id="a"]') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Admin' })).toBeTruthy();
    expect(within(row).queryByText('Viewer')).toBeNull();
  });

  it('create by typing calls the column onCreateEntity', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onCreateEntity = vi.fn(async (label: string) => ({ value: 'new', label }));
    render(BaseTable, {
      rows,
      columns: [nameCol, { ...rolesCol, onCreateEntity }],
      onEdit,
      showEditMode: true,
    });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    const row = document.querySelector('[data-row-id="b"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'No roles assigned' }));
    await user.click(screen.getByRole('button', { name: /Select or search/ }));
    await user.type(screen.getByRole('textbox'), 'Boss{Enter}');
    await waitFor(() => expect(onCreateEntity).toHaveBeenCalledWith('Boss'));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('b', 'roles', ['new']));
  });

  it('singleSelect column picks one value', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(BaseTable, {
      rows,
      columns: [nameCol, { ...rolesCol, singleSelect: true }],
      onEdit,
      showEditMode: true,
    });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    const row = document.querySelector('[data-row-id="a"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Admin' }));
    await user.click(screen.getByRole('button', { name: /Admin/ }));
    await user.click(await pick('Viewer'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('a', 'roles', ['viewer']));
  });
});

describe('filter list keyboard navigation', () => {
  beforeEach(() => setViewport(1280));
  const columns: TableColumn[] = [
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status' },
  ];

  it('arrow keys move the highlight and Enter toggles', async () => {
    const user = userEvent.setup();
    render(BaseTable, { rows, columns });
    await user.click(screen.getByRole('button', { name: 'Filter Status' }));
    const input = await waitFor(() => {
      const i = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
      expect(i).toBeTruthy();
      return i as HTMLInputElement;
    });
    const selected = () =>
      [...document.querySelectorAll('[role=option]')]
        .filter((o) => o.getAttribute('aria-selected') === 'true')
        .map((o) => o.textContent?.trim());
    await waitFor(() => expect(selected()[0]).toMatch(/^done/));
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(selected()[0]).toMatch(/^open/));
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(names()).toEqual(['a', 'c']));
    await fireEvent.keyDown(input, { key: 'ArrowUp' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(names()).toEqual(['a', 'b', 'c']));
  });
});

describe('small v3 elements', () => {
  beforeEach(() => setViewport(1280));

  it('the scroll area carries v3 custom-scrollbar', () => {
    const { container } = render(BaseTable, { rows, columns: [{ key: 'name', label: 'Name' }] });
    expect(container.querySelector('[data-scroll]')?.className).toContain('custom-scrollbar');
  });

  it('a multiline text cell edits in a textarea; Enter adds a line, blur saves', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(BaseTable, {
      rows,
      columns: [{ key: 'note', label: 'Note', multiline: true, editable: true }],
      onEdit,
      showEditMode: true,
    });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await user.click(screen.getAllByRole('button', { name: /line 1/ })[0] as HTMLElement);
    const area = screen.getByRole('textbox');
    expect(area.tagName).toBe('TEXTAREA');
    await user.type(area, '{Enter}x');
    expect(onEdit).not.toHaveBeenCalled();
    await fireEvent.blur(area);
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('a', 'note', 'line 1\nline 2\nx'));
  });

  it('a dropdown cell renders the column renderTrigger and renderOption', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const renderTrigger = createRawSnippet<[{ value: unknown; label: string }]>((v) => ({
      render: () => `<button type="button" data-trigger>custom ${v().label}</button>`,
    }));
    const renderOption = createRawSnippet<[{ option: { value: string; label: string } }]>((o) => ({
      render: () => `<b>opt ${o().option.label}</b>`,
    }));
    render(BaseTable, {
      rows,
      columns: [
        {
          key: 'status',
          label: 'Status',
          kind: 'dropdown',
          editable: true,
          options: [
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Done' },
          ],
          renderTrigger,
          renderOption,
        },
      ],
      onEdit,
      showEditMode: true,
    });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await user.click(screen.getAllByText('custom Open')[0] as HTMLElement);
    const item = await waitFor(() => {
      const found = [...document.querySelectorAll('[role=menuitem]')].find((e) =>
        /opt Done/.test(e.textContent ?? ''),
      );
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    await user.click(item);
    expect(onEdit).toHaveBeenCalledWith('a', 'status', 'done');
  });

  it('exposes getSelectedRows, getGlobalFilter and setGlobalFilter', async () => {
    const user = userEvent.setup();
    const { component } = render(BaseTable, {
      rows,
      columns: [{ key: 'name', label: 'Name' }],
      selectable: true,
    });
    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[1] as HTMLElement);
    const api = component as unknown as {
      getSelectedRows(): TableRow[];
      getGlobalFilter(): string;
      setGlobalFilter(v: string): void;
    };
    expect(api.getSelectedRows().map((r) => r.id)).toEqual(['b']);
    api.setGlobalFilter('Cl');
    await waitFor(() => expect(names()).toEqual(['c']));
    expect(api.getGlobalFilter()).toBe('Cl');
  });
});
