<script lang="ts">
  import { Button } from '../button/index.js';
  import { cn } from '../../../utils.js';
  import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
  import type { ComponentProps } from 'svelte';
  import { useSidebar } from './context.svelte.js';

  let {
    ref = $bindable(null),
    class: className,
    onclick,
    label = 'Toggle sidebar',
    ...restProps
  }: ComponentProps<typeof Button> & {
    onclick?: (e: MouseEvent) => void;
    /** The accessible name; the app passes its own language. */
    label?: string;
  } = $props();

  const sidebar = useSidebar();
</script>

<Button
  data-sidebar="trigger"
  data-slot="sidebar-trigger"
  variant="ghost"
  size="icon"
  class={cn('size-7', className)}
  type="button"
  onclick={(e) => {
    onclick?.(e);
    sidebar.toggle();
  }}
  {...restProps}
>
  <PanelLeftIcon />
  <span class="sr-only">{label}</span>
</Button>
