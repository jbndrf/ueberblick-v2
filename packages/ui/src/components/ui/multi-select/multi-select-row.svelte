<script lang="ts">
  // v3 mobile-multi-select `optionItem` and `createOptionBtn` snippets: one row of the list, as a radio-dot row
  // (option) or the "Create ..." row. `lg` is the 56px-high touch row of the full-screen dialog, `sm` the desktop row.
  import Plus from '@lucide/svelte/icons/plus';
  import { cn } from '../../../utils.js';
  import type { MultiSelectOption } from './types';

  let {
    size,
    option,
    selected = false,
    highlighted = false,
    single = false,
    createLabel,
    createHint,
    onclick,
  }: {
    size: 'sm' | 'lg';
    /** Absent for the create row. */
    option?: MultiSelectOption;
    selected?: boolean;
    highlighted?: boolean;
    /** Single select: the phone row is a radio, otherwise a checkbox (a screen reader hears which row is picked). */
    single?: boolean;
    createLabel?: string;
    createHint?: string;
    onclick: () => void;
  } = $props();
  const isLg = $derived(size === 'lg');
</script>

<button
  type="button"
  class={cn(
    'flex w-full items-center text-left transition-colors',
    option === undefined && 'bg-primary/5',
    isLg
      ? 'min-h-[56px] gap-4 border-b border-border/50 px-4 hover:bg-muted/50 active:bg-muted'
      : 'gap-2 px-3 py-2 hover:bg-accent focus:bg-accent focus:outline-none',
    selected && (isLg ? 'bg-primary/5' : 'bg-accent/50'),
    highlighted && !isLg && 'bg-accent',
  )}
  {onclick}
  data-ms-row=""
  role={option === undefined ? undefined : isLg ? (single ? 'radio' : 'checkbox') : 'option'}
  aria-selected={isLg || option === undefined ? undefined : selected}
  aria-checked={isLg && option !== undefined ? selected : undefined}
  data-highlighted={highlighted}
>
  <div
    class={cn(
      'flex shrink-0 items-center justify-center rounded-full border-2 transition-colors',
      isLg ? 'h-6 w-6' : 'h-4 w-4',
      option === undefined || selected ? 'border-primary bg-primary' : 'border-muted-foreground/50',
    )}
  >
    {#if option === undefined}
      <Plus class={cn('text-primary-foreground', isLg ? 'h-4 w-4' : 'h-3 w-3')} />
    {:else if selected}
      <div class={cn('rounded-full bg-primary-foreground', isLg ? 'h-2.5 w-2.5' : 'h-2 w-2')}></div>
    {/if}
  </div>
  <div class={cn('min-w-0 flex-1', isLg && 'py-2')}>
    {#if option === undefined}
      <div class={cn('truncate font-medium text-primary', isLg ? 'text-base' : 'text-sm')}>{createLabel}</div>
      {#if isLg}<div class="text-sm text-muted-foreground">{createHint}</div>{/if}
    {:else}
      <div class={cn('truncate', isLg ? 'text-base font-medium' : 'text-sm')}>{option.label}</div>
      {#if option.description}
        <div class={cn('truncate text-muted-foreground', isLg ? 'text-sm' : 'text-xs')}>
          {option.description}
        </div>
      {/if}
    {/if}
  </div>
</button>
