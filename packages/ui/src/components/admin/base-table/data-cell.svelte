<script lang="ts">
  // Picks the renderer for a column's kind (cells/registry.ts); `custom` columns bring their own snippet.
  import { CELL_RENDERERS } from './cells/registry';
  import type { CellProps, TableRow } from './types';

  let props: CellProps & { row: TableRow } = $props();
  const Renderer = $derived(
    props.column.kind && props.column.kind !== 'custom'
      ? CELL_RENDERERS[props.column.kind]
      : CELL_RENDERERS.text,
  );
</script>

{#if props.column.kind === 'custom' && props.column.cell}
  {@render props.column.cell({ value: props.value, row: props.row })}
{:else}
  <Renderer
    value={props.value}
    column={props.column}
    rowId={props.rowId}
    editable={props.editable}
    row={props.row}
    onSave={props.onSave}
    silent={props.silent}
  />
{/if}
