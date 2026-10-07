<script lang="ts">
  // v3 data-table-column-header: a click on the title sorts (asc, desc, off); the filter button lists the
  // column's distinct values with counts, to tick.
  import type { Column } from '@tanstack/table-core';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import { Button } from '../../ui/button';
  import * as Popover from '../../ui/popover';
  import FilterList from './filter-list.svelte';
  import { m } from '../../../paraglide/messages.js';
  import { EMPTY_FILTER_KEY } from './types';
  import { serverContext } from './server-context';
  import type { FilterValue, TableRow } from './types';

  let {
    column,
    title,
    emptyLabel,
  }: { column: Column<TableRow, unknown>; title: string; emptyLabel?: string | undefined } = $props();

  let open = $state(false);
  const server = serverContext();

  // Query mode: the rows are one page, so the server counts the values; asked each time the list opens (the other
  // filters may have changed). A late answer to an older opening is dropped.
  let remote = $state<readonly FilterValue[] | null>(null);
  let loadingValues = $state(false);
  let asked = 0;
  $effect(() => {
    const ask = server.filterValues;
    if (!open || !ask) return;
    const mine = ++asked;
    loadingValues = true;
    remote = null;
    ask(column.id)
      .then((list) => {
        if (mine === asked) remote = list;
      })
      .catch(() => {
        if (mine === asked) remote = [];
      })
      .finally(() => {
        if (mine === asked) loadingValues = false;
      });
  });

  const sortable = $derived(column.getCanSort());
  const filterable = $derived(column.getCanFilter());
  const isSorted = $derived(column.getIsSorted());
  const selected = $derived((column.getFilterValue() as string[] | undefined) ?? []);

  // The facet counts are only read while the list is open.
  const values = $derived.by(() => {
    if (!open) return [];
    if (server.filterValues) return (remote ?? []).map((v) => v.value);
    const counts = column.getFacetedUniqueValues();
    return [...counts.keys()].map(String).sort();
  });

  function label(value: string): string {
    if (value === EMPTY_FILTER_KEY) return emptyLabel ?? m.table_filter_empty();
    return remote?.find((v) => v.value === value)?.label ?? value;
  }
  const count = (value: string): number =>
    remote
      ? (remote.find((v) => v.value === value)?.count ?? 0)
      : (column.getFacetedUniqueValues().get(value) ?? 0);

  function toggle(value: string, on: boolean) {
    const next = on ? [...selected, value] : selected.filter((v) => v !== value);
    column.setFilterValue(next.length > 0 ? next : undefined);
  }
</script>

<div class="flex items-center gap-2">
  {#if sortable}
    <Button variant="ghost" size="sm" class="-ml-3 h-8" onclick={() => column.toggleSorting()}>
      <span>{title}</span>
      {#if isSorted === 'asc'}
        <ArrowUp class="ml-2 h-4 w-4" />
      {:else if isSorted === 'desc'}
        <ArrowDown class="ml-2 h-4 w-4" />
      {:else}
        <ArrowUpDown class="ml-2 h-4 w-4" />
      {/if}
    </Button>
  {:else}
    <span class="text-sm font-medium">{title}</span>
  {/if}

  {#if filterable}
    <Popover.Root bind:open>
      <Popover.Trigger
        aria-label={m.table_filter_column({ column: title })}
        class="inline-flex h-8 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
      >
        {#if selected.length > 0}
          <span
            class="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground"
            >{selected.length}</span
          >
        {:else}
          <ListFilter />
        {/if}
      </Popover.Trigger>
      <Popover.Content class="w-[220px] p-0" align="start">
        <FilterList
          {values}
          {selected}
          {label}
          {count}
          loading={loadingValues}
          loadingLabel={server.loadingLabel}
          placeholder={m.table_filter_placeholder({ column: title.toLowerCase() })}
          onToggle={toggle}
          onClear={() => column.setFilterValue(undefined)}
        />
      </Popover.Content>
    </Popover.Root>
  {/if}
</div>
