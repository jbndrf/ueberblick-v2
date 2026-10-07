// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import '../../ui/jsdom-shims.testing';
import { toast } from 'svelte-sonner';
import { overwriteGetLocale } from '../../../paraglide/runtime.js';
import BaseTable from './base-table.svelte';
import { CellRefusal } from './cells/commit';
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

// WP-324: what the Teilnehmende page needs of BaseTable beyond WP-338, at phone and desktop width.
const rows: TableRow[] = [
  { id: 'a', name: 'Anna', token: 'AAAA-BBBB', active: true },
  { id: 'b', name: 'Bernd', token: 'CCCC-DDDD', active: false },
];

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}

afterEach(() => {
  vi.clearAllMocks();
  overwriteGetLocale(() => 'en');
});

describe.each([
  ['phone 390px', 390],
  ['desktop 1280px', 1280],
])('column management at %s', (_n, width) => {
  beforeEach(() => setViewport(width));
  const columns: TableColumn[] = [{ key: 'name', label: 'Name' }];

  it('shows the "+" in the last header (the actions header) and opens the manager', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(BaseTable, {
      rows,
      columns,
      rowMenu: { header: 'Aktionen' },
      columnManagement: { label: 'Feld hinzufügen', onOpen },
    });
    const head = screen.getByRole('columnheader', { name: /Aktionen/ });
    await user.click(within(head).getByRole('button', { name: 'Feld hinzufügen' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    // only one "+": the other headers have none
    expect(screen.getAllByRole('button', { name: 'Feld hinzufügen' })).toHaveLength(1);
  });

  it('puts the "+" in the last data column when there is no actions column', () => {
    render(BaseTable, {
      rows,
      columns: [...columns, { key: 'token', label: 'Token' }],
      columnManagement: { label: 'Feld hinzufügen', onOpen: () => undefined },
    });
    const head = screen.getByRole('columnheader', { name: /Token/ });
    expect(within(head).getByRole('button', { name: 'Feld hinzufügen' })).toBeTruthy();
  });

  it('shows no "+" without columnManagement', () => {
    render(BaseTable, { rows, columns, rowMenu: {} });
    expect(screen.queryByRole('button', { name: 'Feld hinzufügen' })).toBeNull();
  });

  it('renders createAreaPrefix before the confirm button of the add row', async () => {
    const user = userEvent.setup();
    const createAreaPrefix = createRawSnippet(() => ({
      render: () => '<span data-prefix>Vorlage</span>',
    }));
    render(BaseTable, {
      rows,
      columns,
      onAdd: vi.fn(),
      addRow: {},
      createAreaPrefix,
    });
    expect(document.querySelector('[data-prefix]')).toBeNull(); // the add row starts empty
    const addRow = document.querySelector('[data-add-row]') as HTMLElement;
    await user.click(within(addRow).getByRole('button', { name: '-' }));
    await user.type(within(addRow).getByRole('textbox'), 'Neu{Enter}');
    await waitFor(() => expect(document.querySelector('[data-prefix]')).toBeTruthy());
  });
});

describe('a boolean column with `live` (v3 booleanConfig.onToggle: the Status switch)', () => {
  beforeEach(() => setViewport(1280));
  const columns: TableColumn[] = [
    { key: 'name', label: 'Name' },
    { key: 'active', label: 'Status', kind: 'boolean', editable: true, live: true },
  ];

  it('switches outside Bearbeitungsmodus', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(BaseTable, { rows, columns, onEdit });
    const row = document.querySelector('[data-row-id="a"]') as HTMLElement;
    await user.click(within(row).getByRole('switch', { name: 'Status' }));
    expect(onEdit).toHaveBeenCalledWith('a', 'active', false);
  });

  it('a boolean column without `live` stays a Yes/No badge until Bearbeitungsmodus', () => {
    render(BaseTable, {
      rows,
      columns: [{ key: 'active', label: 'Status', kind: 'boolean', editable: true }],
      onEdit: vi.fn(),
    });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getAllByText('Yes').length).toBeGreaterThan(0);
  });
});

describe('copyValue and CellRefusal', () => {
  beforeEach(() => setViewport(1280));

  it('the copy button puts copyValue(row) on the clipboard, not the shown value', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(BaseTable, {
      rows,
      columns: [
        {
          key: 'token',
          label: 'Token',
          copyable: true,
          copyValue: (row) => `https://ueb.test/login?token=${String(row['token'])}`,
        },
      ],
    });
    const row = document.querySelector('[data-row-id="a"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('https://ueb.test/login?token=AAAA-BBBB');
    expect(row.textContent).toContain('AAAA-BBBB');
  });

  it('a CellRefusal shows its own message and keeps the cell open', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockRejectedValue(new CellRefusal('Name ist erforderlich'));
    render(BaseTable, {
      rows,
      columns: [{ key: 'name', label: 'Name', editable: true }],
      onEdit,
      showEditMode: true,
    });
    await user.click(screen.getByRole('switch', { name: 'Edit mode' }));
    await user.click(screen.getAllByRole('button', { name: 'Anna' })[0] as HTMLElement);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Name ist erforderlich'));
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

describe('locale', () => {
  beforeEach(() => setViewport(390));

  it('the table speaks the page language, whatever the ui cookie says', () => {
    render(BaseTable, { rows, columns: [{ key: 'name', label: 'Name' }], locale: 'de' });
    expect(screen.getByRole('searchbox', { name: 'Suchen' })).toBeTruthy();
  });
});

describe('2,000 participants (R14: virtualised)', () => {
  beforeEach(() => setViewport(1280));

  it('renders only the rows in view', () => {
    const many: TableRow[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `p${i}`,
      name: `Person ${i}`,
      token: `TOKEN-${i}`,
      active: i % 2 === 0,
    }));
    render(BaseTable, {
      rows: many,
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'token', label: 'Token', copyable: true },
        { key: 'active', label: 'Status', kind: 'boolean' },
      ],
      selectable: true,
    });
    // The numbers (mount time) are in the WP log; a spec asserts the structure, never the clock (WP-147).
    const inDom = document.querySelectorAll('[data-row-id]').length;
    expect(inDom).toBeGreaterThan(0);
    expect(inDom).toBeLessThan(80);
  });
});
