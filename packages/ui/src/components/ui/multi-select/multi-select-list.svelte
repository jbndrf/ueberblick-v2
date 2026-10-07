<script lang="ts">
  // The rows under the search box: the create row (when typing a new name), the options, or the empty text.
  import MultiSelectRow from './multi-select-row.svelte';
  import { cn } from '../../../utils.js';
  import type { MultiSelectLabels, MultiSelectOption } from './types';

  let {
    size,
    options,
    selectedIds,
    canCreate,
    query,
    highlightedIndex,
    labels,
    single = false,
    onToggle,
    onCreate,
  }: {
    size: 'sm' | 'lg';
    options: readonly MultiSelectOption[];
    selectedIds: readonly string[];
    canCreate: boolean;
    query: string;
    highlightedIndex: number;
    labels: MultiSelectLabels;
    single?: boolean;
    onToggle: (option: MultiSelectOption) => void;
    onCreate: () => void;
  } = $props();
  const isLg = $derived(size === 'lg');
  const offset = $derived(canCreate ? 1 : 0);
</script>

{#if options.length === 0 && !canCreate}
  <div class={cn('text-center text-muted-foreground', isLg ? 'px-4 py-8' : 'px-3 py-4 text-sm')}>
    {labels.empty}
  </div>
{:else}
  <!-- The phone rows carry radio/checkbox state; they sit in a labelled group (WCAG 4.1.2). -->
  <div
    role={isLg ? (single ? 'radiogroup' : 'group') : 'none'}
    aria-label={isLg ? labels.options : undefined}
  >
    {#if canCreate}
      <MultiSelectRow
        {size}
        createLabel={labels.createLabel(query.trim())}
        createHint={labels.createHint}
        highlighted={highlightedIndex === 0}
        onclick={onCreate}
      />
    {/if}
    {#each options as option, i (option.value)}
      <MultiSelectRow
        {size}
        {option}
        selected={selectedIds.includes(option.value)}
        highlighted={highlightedIndex === i + offset}
        {single}
        onclick={() => onToggle(option)}
      />
    {/each}
  </div>
{/if}
