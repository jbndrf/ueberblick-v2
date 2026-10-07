<script lang="ts">
  // v3's row "⋮" menu: Edit, the table's own items, then Delete.
  import MoreHorizontal from '@lucide/svelte/icons/ellipsis';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import * as DropdownMenu from '../../ui/dropdown-menu';
  import { Button } from '../../ui/button';
  import { m } from '../../../paraglide/messages.js';
  import type { RowMenu, TableRow } from './types';

  let {
    row,
    rowId,
    menu,
    onDelete,
  }: {
    row: TableRow;
    rowId: string;
    menu?: RowMenu | undefined;
    onDelete?: ((ids: readonly string[]) => void | Promise<void>) | undefined;
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
        <MoreHorizontal class="h-4 w-4" />
        <span class="sr-only">{m.table_open_menu()}</span>
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    {#if menu?.onEdit}
      <DropdownMenu.Item onclick={() => menu.onEdit?.(row)}>
        <Pencil class="mr-2 h-4 w-4" />
        {m.table_edit()}
      </DropdownMenu.Item>
    {/if}
    {#each menu?.items ?? [] as item, i (i)}
      <DropdownMenu.Item
        class={item.destructive ? 'text-destructive' : ''}
        onclick={() => item.onSelect(row)}
      >
        {#if item.icon}
          {@const Icon = item.icon}
          <Icon class="mr-2 h-4 w-4" />
        {/if}
        {typeof item.label === 'function' ? item.label(row) : item.label}
      </DropdownMenu.Item>
    {/each}
    {#if onDelete}
      <DropdownMenu.Separator />
      <DropdownMenu.Item class="text-destructive" onclick={() => onDelete([rowId])}>
        <Trash2 class="mr-2 h-4 w-4" />
        {m.table_delete()}
      </DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
