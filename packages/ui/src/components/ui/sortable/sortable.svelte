<script lang="ts" generics="T">
  // A list the user orders by dragging (v3's drag order, `admin/+layout.svelte:79-136`; the field managers showed a grip,
  // `custom-field-manager-generic.svelte:240`). Each row gets a `grip` (the drag handle, a button: focus it and press
  // ArrowUp/ArrowDown to move the row) and `moves` (an up and a down button for a phone, where HTML5 drag does not
  // work; shown below the `sm` breakpoint and on coarse pointers). The list reports the new order of all keys and the key
  // that moved (`onreorder`); the owner saves it and passes the saved order back as `items`.
  import type { Snippet } from 'svelte';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import { cn } from '../../../utils.js';
  import { Button } from '../button/index.js';
  import SortableItem from './sortable-item.svelte';
  import { SortableState, type Reorder } from './state.svelte.js';

  let {
    items,
    key,
    onreorder,
    label,
    handleLabel,
    upLabel,
    downLabel,
    announce,
    disabled = false,
    class: className,
    itemClass,
    testId,
    row,
  }: {
    items: readonly T[];
    key: (item: T) => string;
    onreorder: (change: Reorder) => void | Promise<void>;
    /** The accessible name of the list. */
    label: string;
    /** The accessible names of one row's controls ("Move column: Name"). */
    handleLabel: (item: T) => string;
    upLabel: (item: T) => string;
    downLabel: (item: T) => string;
    /** What a screen reader hears after a move ("Name, position 2 of 5"). */
    announce?: (item: T, position: number, total: number) => string;
    /** Locks the order (a save is running, so a second move does not start from the old order). */
    disabled?: boolean;
    class?: string;
    itemClass?: string;
    /** `data-testid` of a row. */
    testId?: (item: T) => string;
    /** One row; place `grip`  (up and down buttons for a phone) where the design wants them. */
    row: Snippet<[item: T, index: number, grip: Snippet<[T]>, moves: Snippet<[T, number]>]>;
  } = $props();

  const sortable = new SortableState();
  const keys = $derived(items.map(key));
  let heard = $state('');

  function reorder(change: Reorder): void | Promise<void> {
    if (disabled) return;
    const at = change.keys.indexOf(change.moved);
    const item = items.find((it) => key(it) === change.moved);
    if (announce && item !== undefined) heard = announce(item, at + 1, change.keys.length);
    return onreorder(change);
  }
  function move(k: string, delta: -1 | 1): void {
    const change = sortable.step(keys, k, delta);
    if (change) void reorder(change);
  }
</script>

{#snippet grip(item: T)}
  <button
    type="button"
    data-sortable-handle
    class="cursor-grab rounded-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
    aria-label={handleLabel(item)}
    aria-keyshortcuts="ArrowUp ArrowDown"
    {disabled}
  >
    <GripVertical class="h-4 w-4" />
  </button>
{/snippet}

{#snippet moves(item: T, index: number)}
  <div class="hidden gap-1 pointer-coarse:flex max-sm:flex">
    <Button
      variant="ghost"
      size="icon"
      class="h-8 w-8"
      disabled={index === 0 || disabled}
      aria-label={upLabel(item)}
      onclick={() => move(key(item), -1)}
    >
      <ArrowUp class="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="h-8 w-8"
      disabled={index === items.length - 1 || disabled}
      aria-label={downLabel(item)}
      onclick={() => move(key(item), 1)}
    >
      <ArrowDown class="h-4 w-4" />
    </Button>
  </div>
{/snippet}

<div role="list" aria-label={label} class={cn(className)} data-slot="sortable">
  {#each items as item, index (key(item))}
    <SortableItem
      state={sortable}
      id={key(item)}
      {keys}
      {disabled}
      onreorder={reorder}
      class={itemClass}
      data-testid={testId?.(item)}
    >
      {@render row(item, index, grip, moves)}
    </SortableItem>
  {/each}
</div>
<div class="sr-only" role="status" aria-live="polite">{heard}</div>
