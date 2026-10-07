<script lang="ts">
  // v3 data-table-column-header filter: a Command list (search, arrow keys, Enter) of the column's distinct values with
  // counts, each with a checkbox, and a "Clear filter" entry once something is ticked.
  import { Command } from 'bits-ui';
  import Search from '@lucide/svelte/icons/search';
  import { Checkbox } from '../../ui/checkbox';
  import { Spinner } from '../../ui/spinner';
  import { m } from '../../../paraglide/messages.js';

  let {
    values,
    selected,
    label,
    count,
    loading = false,
    loadingLabel,
    placeholder,
    onToggle,
    onClear,
  }: {
    values: readonly string[];
    selected: readonly string[];
    label: (value: string) => string;
    count: (value: string) => number;
    /** Query mode: the values are on their way. */
    loading?: boolean;
    loadingLabel?: string | undefined;
    placeholder: string;
    onToggle: (value: string, on: boolean) => void;
    onClear: () => void;
  } = $props();
</script>

<Command.Root
  data-slot="command"
  class="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground"
>
  <div class="flex h-9 items-center gap-2 border-b pr-8 pl-3" data-slot="command-input-wrapper">
    <Search class="size-4 shrink-0 opacity-50" />
    <Command.Input
      data-slot="command-input"
      {placeholder}
      aria-label={placeholder}
      class="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
    />
  </div>
  <Command.List
    data-slot="command-list"
    class="custom-scrollbar max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto"
  >
    {#if loading}
      <div class="flex justify-center py-6"><Spinner aria-label={loadingLabel ?? ''} /></div>
    {:else}
      <Command.Empty data-slot="command-empty" class="py-6 text-center text-sm"
        >{m.table_filter_none()}</Command.Empty
      >
    {/if}
    <Command.Group class="overflow-hidden p-1 text-foreground">
      <Command.GroupItems>
        {#each values as value (value)}
          {@const isSelected = selected.includes(value)}
          <Command.Item
            {value}
            keywords={[label(value)]}
            onSelect={() => onToggle(value, !isSelected)}
            data-slot="command-item"
            class="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          >
            <div class="flex w-full items-center gap-2">
              <Checkbox checked={isSelected} tabindex={-1} class="pointer-events-none" aria-hidden="true" />
              <span class="flex-1 truncate">{label(value)}</span>
              <span class="text-xs text-muted-foreground">({count(value)})</span>
            </div>
          </Command.Item>
        {/each}
      </Command.GroupItems>
    </Command.Group>
    {#if selected.length > 0}
      <Command.Separator class="-mx-1 h-px bg-border" />
      <Command.Group class="overflow-hidden p-1 text-foreground">
        <Command.GroupItems>
          <Command.Item
            value="__clear__"
            onSelect={onClear}
            data-slot="command-item"
            class="relative flex cursor-default items-center justify-center gap-2 rounded-sm px-2 py-1.5 text-center text-sm outline-hidden select-none aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            {m.table_clear_filter()}
          </Command.Item>
        </Command.GroupItems>
      </Command.Group>
    {/if}
  </Command.List>
</Command.Root>
