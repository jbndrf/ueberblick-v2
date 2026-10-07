<script lang="ts">
  import type { HeaderGroup, Table } from '@tanstack/table-core';
  import * as TableUi from '../../ui/table';
  import Plus from '@lucide/svelte/icons/plus';
  import { Checkbox } from '../../ui/checkbox';
  import { Button } from '../../ui/button';
  import { m } from '../../../paraglide/messages.js';
  import ColumnHeader from './column-header.svelte';
  import { columnStyle, paddingClass, pinClass } from './layout';
  import { ACTIONS_COLUMN, SELECT_COLUMN } from './types';
  import type { ColumnManagement, RowMenu, TableColumn, TableRow } from './types';

  let {
    table,
    group,
    columns,
    menu,
    management,
    rowEdit = false,
  }: {
    table: Table<TableRow>;
    group: HeaderGroup<TableRow>;
    columns: readonly TableColumn[];
    menu?: RowMenu | undefined;
    management?: ColumnManagement | undefined;
    /** The table saves rows (`onRowSave`): the actions column is wide enough for check and x. */
    rowEdit?: boolean;
  } = $props();

  /** The actions header also holds the "+" of the column manager; v3's 64 px clipped "Aktionen" next to it. */
  const MANAGED_ACTIONS_WIDTH = 128;
  const lastId = $derived(group.headers[group.headers.length - 1]?.column.id);
</script>

<TableUi.Row class="group hover:bg-muted/50">
  {#each group.headers as header (header.id)}
    {@const id = header.column.id}
    {@const col = columns.find((c) => c.key === id)}
    <TableUi.Head
      class="{paddingClass(
        id,
      )} bg-muted/50 py-3 text-sm font-medium whitespace-nowrap text-muted-foreground {pinClass(
        id,
        'head',
      )} {id === SELECT_COLUMN || id === ACTIONS_COLUMN ? 'bg-card' : ''}"
      style={management && id === lastId && id === ACTIONS_COLUMN
        ? `min-width: ${MANAGED_ACTIONS_WIDTH}px; width: ${MANAGED_ACTIONS_WIDTH}px;`
        : columnStyle(id, columns, rowEdit)}
    >
      {#if id === SELECT_COLUMN}
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)}
          aria-label={m.table_select_all()}
        />
      {:else if management && id === lastId}
        <!-- v3: the "+" sits in the last header (the actions column when there is one) and opens the column manager -->
        <div class="flex items-center justify-between gap-2">
          {#if id === ACTIONS_COLUMN}
            {menu?.header ?? m.table_actions()}
          {:else if col}
            <ColumnHeader column={header.column} title={col.label} emptyLabel={col.emptyLabel} />
          {/if}
          <Button
            variant="outline"
            size="icon"
            onclick={management.onOpen}
            aria-label={management.label}
            class="-mr-2 h-7 w-7 border-border hover:bg-accent hover:text-accent-foreground"
          >
            <Plus class="h-4 w-4" />
          </Button>
        </div>
      {:else if id === ACTIONS_COLUMN}
        {menu?.header ?? m.table_actions()}
      {:else if col}
        <ColumnHeader column={header.column} title={col.label} emptyLabel={col.emptyLabel} />
      {/if}
    </TableUi.Head>
  {/each}
</TableUi.Row>
