<script lang="ts">
  // v3's always-visible creation row (inlineRowCreation): fill the cells, then confirm with the check button.
  import type { Snippet } from 'svelte';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import CheckIcon from '@lucide/svelte/icons/check';
  import XIcon from '@lucide/svelte/icons/x';
  import * as TableUi from '../../ui/table';
  import { Button } from '../../ui/button';
  import { m } from '../../../paraglide/messages.js';
  import DataCell from './data-cell.svelte';
  import { isBlank } from './cells/format';
  import { columnStyle, paddingClass, pinClass } from './layout';
  import { ACTIONS_COLUMN, SELECT_COLUMN } from './types';
  import type { AddRowOptions, TableColumn, TableRow } from './types';

  let {
    columns,
    columnIds,
    options,
    onAdd,
    prefix,
  }: {
    columns: readonly TableColumn[];
    /** The table's column ids in display order, including select and actions. */
    columnIds: readonly string[];
    options: AddRowOptions;
    onAdd: (values: TableRow) => void | Promise<void>;
    prefix?: Snippet | undefined;
  } = $props();

  function defaults(): TableRow {
    const values: TableRow = { ...options.defaultValues?.() };
    for (const col of columns) {
      const first = col.options?.[0];
      if (col.kind === 'dropdown' && first && values[col.key] === undefined) values[col.key] = first.value;
    }
    return values;
  }

  let values = $state<TableRow>(defaults());
  let started = $state(false);
  let saving = $state(false);

  const missing = (key: string) => (options.requiredKeys ?? []).includes(key) && isBlank(values[key]);

  function set(key: string, value: unknown) {
    values[key] = value;
    if (!isBlank(value)) started = true;
  }

  function reset() {
    started = false;
    values = defaults();
  }

  async function save() {
    if ((options.requiredKeys ?? []).some(missing)) return;
    saving = true;
    try {
      await onAdd({ ...values });
      reset();
    } catch (error) {
      console.error('Failed to create row:', error);
    } finally {
      saving = false;
    }
  }
</script>

<TableUi.Row data-add-row class="group {started ? 'bg-accent/10' : 'bg-muted/20'}">
  {#each columnIds as id (id)}
    {@const col = columns.find((c) => c.key === id)}
    <TableUi.Cell
      class="{paddingClass(id)} py-4 {pinClass(id, 'body')} {id === SELECT_COLUMN || id === ACTIONS_COLUMN
        ? 'bg-card'
        : 'overflow-hidden'} {started && missing(id) ? 'ring-1 ring-destructive ring-inset' : ''}"
      style={columnStyle(id, columns)}
    >
      {#if id === SELECT_COLUMN}
        <PlusIcon class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      {:else if id === ACTIONS_COLUMN}
        {#if started}
          <div class="flex items-center gap-1">
            {#if prefix}{@render prefix()}{/if}
            <Button variant="ghost" size="icon" onclick={save} disabled={saving} class="h-7 w-7">
              <CheckIcon class="h-4 w-4" />
              <span class="sr-only">{m.table_add_confirm()}</span>
            </Button>
            <Button variant="ghost" size="icon" onclick={reset} disabled={saving} class="h-7 w-7">
              <XIcon class="h-4 w-4" />
              <span class="sr-only">{m.table_add_cancel()}</span>
            </Button>
          </div>
        {/if}
      {:else if options.excludedKeys?.includes(id)}
        <span class="text-xs text-muted-foreground">{m.table_auto()}</span>
      {:else if col}
        <DataCell
          value={values[id]}
          column={col}
          rowId="new-row"
          row={values}
          editable={true}
          silent={true}
          onSave={(value) => set(id, value)}
        />
      {/if}
    </TableUi.Cell>
  {/each}
</TableUi.Row>
