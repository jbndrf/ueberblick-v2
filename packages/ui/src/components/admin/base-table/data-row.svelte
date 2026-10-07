<script lang="ts">
  import type { Row, Table } from '@tanstack/table-core';
  import CheckIcon from '@lucide/svelte/icons/check';
  import XIcon from '@lucide/svelte/icons/x';
  import * as TableUi from '../../ui/table';
  import { Button } from '../../ui/button';
  import { Checkbox } from '../../ui/checkbox';
  import { m } from '../../../paraglide/messages.js';
  import DataCell from './data-cell.svelte';
  import RowMenuButton from './row-menu.svelte';
  import type { RowEdits } from './row-edits.svelte';
  import { columnStyle, paddingClass, pinClass } from './layout';
  import { ACTIONS_COLUMN, ROW_HEIGHT, SELECT_COLUMN } from './types';
  import type { BaseTableProps, TableRow } from './types';

  let {
    row,
    rowIndex,
    table,
    props,
    editMode,
    edits,
    onCheckboxClick,
  }: {
    row: Row<TableRow>;
    rowIndex: number;
    table: Table<TableRow>;
    props: BaseTableProps;
    editMode: boolean;
    /** The collected edits of the rows (`onRowSave`, owner answer A1); empty when the table saves cell by cell. */
    edits: RowEdits;
    onCheckboxClick: (event: MouseEvent, rowIndex: number) => void;
  } = $props();

  const selected = $derived(row.getIsSelected());
  const shown = $derived(edits.row(row.id, row.original));
  const editing = $derived(edits.has(row.id));
  const pinned = $derived(`bg-card group-hover:bg-muted/50 ${selected ? 'bg-muted/50' : ''}`);
  let rowEl = $state<HTMLElement | null>(null);
  /**
   * Keys of a row being edited (only with `onRowSave`): Enter saves it, Escape discards it. Only when the row itself has
   * the focus: the cell editors own their own Enter and Escape (they end the cell edit and hand the focus back here).
   */
  function rowKey(event: KeyboardEvent): void {
    if (!edits.enabled || !editing || event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void edits.commit(row.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      edits.cancel(row.id);
    }
  }
  /** A cell that is not `live` collects its edit in the row when the table has `onRowSave`. */
  const collects = (live: boolean | undefined): boolean => edits.enabled && live !== true;
</script>

<TableUi.Row
  bind:ref={rowEl}
  data-row-id={row.id}
  tabindex={edits.enabled && editing ? 0 : undefined}
  onkeydown={rowKey}
  class="group {selected ? 'bg-muted/50' : ''} {props.onRowClick && !editMode ? 'cursor-pointer' : ''}"
  style="height: {ROW_HEIGHT}px"
  onclick={() => {
    if (props.onRowClick && !editMode) props.onRowClick(row.original);
  }}
>
  {#each row.getVisibleCells() as cell (cell.id)}
    {@const id = cell.column.id}
    {@const col = props.columns.find((c) => c.key === id)}
    {@const refused = edits.error(row.id, id)}
    <TableUi.Cell
      class="{paddingClass(id)} py-4 {pinClass(id, 'body')} {id === SELECT_COLUMN || id === ACTIONS_COLUMN
        ? pinned
        : 'overflow-hidden'} {refused !== undefined ? 'ring-1 ring-destructive ring-inset' : ''}"
      style={columnStyle(id, props.columns, props.onRowSave !== undefined)}
      aria-invalid={refused !== undefined ? 'true' : undefined}
      title={refused}
      onclick={(e: MouseEvent) => {
        if (id === SELECT_COLUMN || id === ACTIONS_COLUMN) e.stopPropagation();
      }}
    >
      {#if id === SELECT_COLUMN}
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
          onclick={(e) => onCheckboxClick(e, rowIndex)}
          aria-label={m.table_select_row()}
        />
      {:else if id === ACTIONS_COLUMN}
        {#if editing}
          <div class="flex items-center" data-row-edit-actions>
            <Button
              variant="ghost"
              size="icon"
              class="-my-3.5 h-11 w-11"
              disabled={edits.saving(row.id)}
              onclick={() => void edits.commit(row.id)}
            >
              <CheckIcon class="h-4 w-4" />
              <span class="sr-only">{m.table_row_save()}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="-my-3.5 h-11 w-11"
              disabled={edits.saving(row.id)}
              onclick={() => edits.cancel(row.id)}
            >
              <XIcon class="h-4 w-4" />
              <span class="sr-only">{m.table_row_cancel()}</span>
            </Button>
          </div>
        {:else if props.rowMenu || props.onDelete}
          <RowMenuButton row={row.original} rowId={row.id} menu={props.rowMenu} onDelete={props.onDelete} />
        {/if}
      {:else if col}
        <DataCell
          value={collects(col.live) ? shown[id] : cell.getValue()}
          column={col}
          rowId={row.id}
          row={shown}
          editable={(editMode || col.live === true) &&
            col.editable === true &&
            (props.onEdit !== undefined || edits.enabled)}
          silent={collects(col.live)}
          onSave={(value) => {
            if (!collects(col.live)) return props.onEdit?.(row.id, col.key, value);
            edits.set(row.id, col.key, value, row.original);
            setTimeout(() => rowEl?.focus(), 0); // a following Enter saves the row
          }}
        />
      {/if}
    </TableUi.Cell>
  {/each}
</TableUi.Row>
