<script lang="ts">
  // v3 mobile-multi-select `searchBox` snippet: the picked options as removable badges and the search input, in one field.
  import X from '@lucide/svelte/icons/x';
  import { Badge } from '../badge';
  import { cn } from '../../../utils.js';
  import type { MultiSelectLabels, MultiSelectOption } from './types';

  let {
    size,
    selectedOptions,
    singleSelect,
    labels,
    query = $bindable(''),
    input = $bindable(null),
    onremove,
    onkeydown,
    onfocus,
    onblur,
  }: {
    size: 'sm' | 'lg';
    selectedOptions: readonly MultiSelectOption[];
    singleSelect: boolean;
    labels: MultiSelectLabels;
    query: string;
    input: HTMLInputElement | null;
    onremove: (value: string, event: Event) => void;
    onkeydown: (event: KeyboardEvent) => void;
    onfocus?: () => void;
    onblur?: (event: FocusEvent) => void;
  } = $props();
  const isLg = $derived(size === 'lg');
</script>

<div
  class={cn(
    'flex flex-wrap items-center gap-1.5 rounded-lg bg-muted',
    isLg ? 'min-h-[44px] px-3 py-2' : 'min-h-[36px] rounded-md px-2 py-1.5',
  )}
>
  {#each selectedOptions as option (option.value)}
    <Badge variant="secondary" class={cn('shrink-0 gap-1 pr-1', !isLg && 'text-xs')}>
      {option.label}
      {#if !singleSelect}
        <button
          type="button"
          onclick={(e) => onremove(option.value, e)}
          class={cn(
            'rounded-full hover:bg-muted-foreground/20 focus:outline-none',
            isLg ? 'ml-1 focus:ring-1 focus:ring-ring' : 'ml-0.5',
          )}
          aria-label={labels.removeOption(option.label)}
        >
          <X class="h-3 w-3" />
        </button>
      {/if}
    </Badge>
  {/each}
  <input
    bind:this={input}
    type="text"
    bind:value={query}
    {onkeydown}
    {onfocus}
    {onblur}
    aria-label={labels.search}
    placeholder={selectedOptions.length === 0 ? labels.search : ''}
    class={cn(
      'flex-1 bg-transparent outline-none placeholder:text-muted-foreground',
      isLg ? 'min-w-[80px] text-base' : 'min-w-[60px] text-sm',
    )}
  />
</div>
