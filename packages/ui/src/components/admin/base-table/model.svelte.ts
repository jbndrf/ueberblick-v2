import { untrack } from 'svelte';
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type Table,
} from '@tanstack/table-core';
import { createSvelteTable } from '../../ui/data-table';
import { ACTIONS_COLUMN, EMPTY_FILTER_KEY, SELECT_COLUMN } from './types';
import type { BaseTableProps, TableColumn, TableQuery, TableRow } from './types';
import { isBlank } from './cells/format';

export interface BaseTableModel {
  table: Table<TableRow>;
  readonly globalFilter: string;
  setGlobalFilter(value: string): void;
  readonly hasActiveFilters: boolean;
  clearFilters(): void;
  /** A click on a row checkbox: with Shift it selects the rows from the last clicked one to this one. */
  checkboxClick(event: MouseEvent, rowIndex: number): void;
}

/** The keys a row's value counts under in a column's filter list: array values count once per entry. */
export function filterKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.length === 0 ? [EMPTY_FILTER_KEY] : value.map(String);
  return isBlank(value) ? [EMPTY_FILTER_KEY] : [String(value)];
}

function columnDefs(props: BaseTableProps): ColumnDef<TableRow>[] {
  const defs: ColumnDef<TableRow>[] = [];
  if (props.selectable) {
    defs.push({ id: SELECT_COLUMN, enableSorting: false, enableColumnFilter: false });
  }
  for (const col of props.columns) {
    defs.push({
      id: col.key,
      accessorFn: (row) => row[col.key],
      header: col.label,
      enableSorting: col.sortable !== false,
      enableColumnFilter: col.filterable !== false,
      sortDescFirst: false,
      filterFn: (row, id, selected: readonly string[]) =>
        !selected || selected.length === 0 || filterKeys(row.getValue(id)).some((k) => selected.includes(k)),
    });
  }
  if (props.rowMenu || props.onDelete || props.addRow || props.onRowSave) {
    defs.push({ id: ACTIONS_COLUMN, enableSorting: false, enableColumnFilter: false });
  }
  return defs;
}

export function createBaseTableModel(getProps: () => BaseTableProps): BaseTableModel {
  const props = getProps();
  // The query the table starts with (a page that comes back from a detail page; read once).
  const start = props.initialQuery;
  let globalFilter = $state(start?.search ?? '');
  let columnFilters = $state<ColumnFiltersState>(
    Object.entries(start?.filters ?? {})
      .filter(([, value]) => value.length > 0)
      .map(([id, value]) => ({ id, value })),
  );
  let sorting = $state<SortingState>(
    start?.sort ? [{ id: start.sort.key, desc: start.sort.direction === 'desc' }] : [],
  );
  let rowSelection = $state<RowSelectionState>({});
  let lastClicked = $state<number | null>(null);

  // Facet counts per column, rebuilt only when the rows change (never per keystroke or scroll).
  const facets = new Map<string, { source: unknown; counts: Map<unknown, number> }>();

  const defs = $derived(columnDefs(props));
  const query = $derived(props.onQueryChange !== undefined);

  const table = createSvelteTable<TableRow>({
    get data() {
      return props.rows as TableRow[];
    },
    get columns() {
      return defs;
    },
    get manualFiltering() {
      return query;
    },
    get manualSorting() {
      return query;
    },
    get enableRowSelection() {
      return props.selectable === true;
    },
    getRowId: (row, index) => (props.getRowId ? props.getRowId(row) : String(row.id ?? index)),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedUniqueValues: (t, columnId) => () => {
      const source = t.getPreFilteredRowModel();
      const hit = facets.get(columnId);
      if (hit && hit.source === source) return hit.counts;
      const counts = new Map<unknown, number>();
      for (const row of source.flatRows) {
        for (const key of filterKeys(row.getValue(columnId))) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      facets.set(columnId, { source, counts });
      return counts;
    },
    state: {
      get globalFilter() {
        return globalFilter;
      },
      get columnFilters() {
        return columnFilters;
      },
      get sorting() {
        return sorting;
      },
      get rowSelection() {
        return rowSelection;
      },
    },
    onGlobalFilterChange: (u) => (globalFilter = typeof u === 'function' ? u(globalFilter) : u),
    onColumnFiltersChange: (u) => (columnFilters = typeof u === 'function' ? u(columnFilters) : u),
    onSortingChange: (u) => (sorting = typeof u === 'function' ? u(sorting) : u),
    onRowSelectionChange: (u) => {
      rowSelection = typeof u === 'function' ? u(rowSelection) : u;
      const ids = Object.keys(rowSelection).filter((id) => rowSelection[id]);
      props.onSelectionChange?.(ids);
    },
  });

  // Query mode: the parent answers; it hears every change of search, sort, filters and page.
  $effect(() => {
    if (!props.onQueryChange) return;
    const first = sorting[0];
    const filters: Record<string, readonly string[]> = {};
    for (const f of columnFilters) filters[f.id] = f.value as readonly string[];
    const q: TableQuery = {
      search: globalFilter,
      sort: first ? { key: first.id, direction: first.desc ? 'desc' : 'asc' } : null,
      filters,
      page: props.page ?? 0,
    };
    untrack(() => props.onQueryChange?.(q));
  });

  return {
    table,
    get globalFilter() {
      return globalFilter;
    },
    setGlobalFilter: (value) => (globalFilter = value),
    get hasActiveFilters() {
      return globalFilter !== '' || columnFilters.length > 0;
    },
    clearFilters() {
      globalFilter = '';
      table.resetColumnFilters();
    },
    checkboxClick(event, rowIndex) {
      if (!event.shiftKey || lastClicked === null) {
        lastClicked = rowIndex;
        return;
      }
      event.preventDefault();
      const rows = table.getRowModel().rows;
      const next: RowSelectionState = { ...rowSelection };
      for (let i = Math.min(lastClicked, rowIndex); i <= Math.max(lastClicked, rowIndex); i++) {
        const row = rows[i];
        if (row) next[row.id] = true;
      }
      table.setRowSelection(next);
    },
  };
}

export type { TableColumn };
