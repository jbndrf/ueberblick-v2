<script lang="ts">
  // v3 dropdown-field: the label, or a menu of the column's options where the cell is editable.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import * as DropdownMenu from '../../../ui/dropdown-menu';
  import { Button } from '../../../ui/button';
  import { commitCell } from './commit';
  import type { CellProps } from '../types';

  let props: CellProps = $props();
  const { value, column, editable } = $derived(props);
  const label = $derived(
    column.getDisplayLabel
      ? column.getDisplayLabel(value)
      : (column.options?.find((o) => o.value === value)?.label ?? String(value ?? '-')),
  );
</script>

{#if editable}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props: triggerProps })}
        {#if column.renderTrigger}
          <div {...triggerProps} class="w-full">{@render column.renderTrigger({ value, label })}</div>
        {:else}
          <Button {...triggerProps} variant="outline" size="sm" class="h-8 w-full justify-between">
            {label}
            <ChevronDown class="ml-2 h-3 w-3" />
          </Button>
        {/if}
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content>
      {#each column.options ?? [] as option (option.value)}
        <DropdownMenu.Item onclick={() => void commitCell(props, option.value)}>
          {#if column.renderOption}
            {@render column.renderOption({ option })}
          {:else}
            <div class="flex flex-col">
              <span>{option.label}</span>
              {#if option.description}<span class="text-xs text-muted-foreground">{option.description}</span
                >{/if}
            </div>
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else}
  <div class="text-sm">{label}</div>
{/if}
