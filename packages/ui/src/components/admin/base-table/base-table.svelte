<script lang="ts">
  // v3's BaseTable (admin/base-table/base-table.svelte): the one table every admin list uses. It takes rows and
  // column definitions and fetches nothing; with `onQueryChange` it leaves filtering and sorting to the parent.
  import { get } from 'svelte/store';
  import { untrack } from 'svelte';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import * as TableUi from '../../ui/table';
  import { m } from '../../../paraglide/messages.js';
  import { overwriteGetLocale } from '../../../paraglide/runtime.js';
  import { Spinner } from '../../ui/spinner';
  import { provideServerContext } from './server-context';
  import TableToolbar from './table-toolbar.svelte';
  import HeadRow from './head-row.svelte';
  import DataRow from './data-row.svelte';
  import AddRow from './add-row.svelte';
  import { createBaseTableModel } from './model.svelte';
  import { RowEdits } from './row-edits.svelte';
  import { columnWidth } from './layout';
  import { ROW_HEIGHT } from './types';
  import type { BaseTableProps, TableRow } from './types';

  const props: BaseTableProps = $props();
  // The ui catalogue reads its own locale cookie; the page's language (the admin's `ub_locale`) wins while the table is on screen.
  const language = untrack(() => props.locale);
  if (language) overwriteGetLocale(() => language);
  provideServerContext(() => ({ filterValues: props.filterValues, loadingLabel: props.loadingLabel }));

  const model = createBaseTableModel(() => props);
  const table = model.table;
  let editMode = $state(false);
  const edits = new RowEdits(() => props.onRowSave);
  // Leaving Bearbeitungsmodus ends the edits that were not saved.
  $effect(() => {
    if (!editMode) untrack(() => edits.cancelAll());
  });
  let scroller = $state<HTMLDivElement | null>(null);

  const rows = $derived(table.getRowModel().rows);
  const columnIds = $derived(table.getVisibleLeafColumns().map((c) => c.id));
  const totalWidth = $derived(
    columnIds.reduce((sum, id) => sum + columnWidth(id, props.columns, props.onRowSave !== undefined), 0),
  );

  // Only the rows in view (plus a few) are in the DOM, however many rows the table holds.
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: untrack(() => table.getRowModel().rows.length),
    getScrollElement: () => scroller,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    initialRect: { width: 1000, height: 800 },
  });
  $effect(() => {
    const count = rows.length;
    untrack(() => get(virtualizer).setOptions({ count }));
  });
  const items = $derived($virtualizer.getVirtualItems());
  // Query mode: with the last rows in view the parent may load the next page (the page is O(page), never all rows).
  const REACH_END_ROWS = 20;
  $effect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= rows.length - REACH_END_ROWS) untrack(() => props.onReachEnd?.());
  });
  const total = $derived($virtualizer.getTotalSize());
  /** The rows ticked in the first column (v3 `getSelectedRows`), through the component's bind:this. */
  export function getSelectedRows(): TableRow[] {
    return table.getFilteredSelectedRowModel().rows.map((r) => r.original);
  }
  export function getGlobalFilter(): string {
    return model.globalFilter;
  }
  export function setGlobalFilter(value: string): void {
    model.setGlobalFilter(value);
  }
  const checkboxClick = $derived(props.shiftSelect === false ? () => {} : model.checkboxClick);
</script>

<div class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-4">
  {#if props.showToolbar !== false}
    <TableToolbar
      searchValue={model.globalFilter}
      onSearchChange={model.setGlobalFilter}
      onClearFilters={model.clearFilters}
      hasActiveFilters={model.hasActiveFilters}
      showEditMode={props.showEditMode}
      bind:editMode
      editModeLabel={props.editModeLabel}
    />
  {/if}

  <div class="flex min-h-0 w-full flex-1 overflow-hidden rounded-lg border border-border bg-card">
    <div
      bind:this={scroller}
      data-scroll
      class="custom-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-auto"
    >
      <table
        data-slot="table"
        class="caption-bottom text-sm"
        style="table-layout: fixed; width: max(100%, {totalWidth}px)"
      >
        <TableUi.Header class="sticky top-0 z-20">
          {#each table.getHeaderGroups() as group (group.id)}
            <HeadRow
              {table}
              {group}
              columns={props.columns}
              rowEdit={props.onRowSave !== undefined}
              menu={props.rowMenu}
              management={props.columnManagement}
            />
          {/each}
        </TableUi.Header>
        <TableUi.Body>
          {#if rows.length === 0 && !props.addRow}
            <TableUi.Row>
              <TableUi.Cell colspan={columnIds.length} class="px-6 py-12 text-center">
                <div class="flex flex-col items-center gap-2 text-muted-foreground">
                  {#if props.loading}
                    <Spinner aria-label={props.loadingLabel ?? ''} />
                  {:else}
                    <p class="text-sm">{props.emptyMessage ?? m.table_empty()}</p>
                    {#if props.emptySubMessage}<p class="text-xs">{props.emptySubMessage}</p>{/if}
                  {/if}
                </div>
              </TableUi.Cell>
            </TableUi.Row>
          {/if}
          {#if rows.length > 0 && items.length > 0}
            <tr aria-hidden="true" style="height: {items[0]?.start ?? 0}px"></tr>
            {#each items as item (rows[item.index]?.id ?? item.index)}
              {@const row = rows[item.index]}
              {#if row}
                <DataRow
                  {row}
                  rowIndex={item.index}
                  {table}
                  {props}
                  {editMode}
                  {edits}
                  onCheckboxClick={checkboxClick}
                />
              {/if}
            {/each}
            <tr aria-hidden="true" style="height: {total - (items[items.length - 1]?.end ?? 0)}px"></tr>
          {/if}
          {#if props.loadingMore}
            <TableUi.Row>
              <TableUi.Cell colspan={columnIds.length} class="py-3 text-center">
                <Spinner class="inline-block text-muted-foreground" aria-label={props.loadingLabel ?? ''} />
              </TableUi.Cell>
            </TableUi.Row>
          {/if}
          {#if props.addRow && props.onAdd}
            <AddRow
              columns={props.columns}
              {columnIds}
              options={props.addRow}
              onAdd={props.onAdd}
              prefix={props.createAreaPrefix}
            />
          {/if}
        </TableUi.Body>
      </table>
    </div>
  </div>
</div>
