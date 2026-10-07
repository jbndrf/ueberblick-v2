<script lang="ts">
  // One draggable entry of a sortable list: native HTML5 drag as in v3 (`+layout.svelte:79-136`), a drop line on the
  // half the pointer is over, and keyboard reorder (ArrowUp/ArrowDown on the focused handle; Alt+ArrowUp/ArrowDown
  // anywhere in the entry when it has no handle, as in the sidebar where the whole entry is the grip).
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '../../../utils.js';
  import type { Reorder, SortableState } from './state.svelte.js';

  let {
    state: sortable,
    id,
    keys,
    onreorder,
    disabled = false,
    role = 'listitem',
    class: className,
    children,
    ...rest
  }: {
    state: SortableState;
    id: string;
    /** The keys of the whole list, in their current order. */
    keys: readonly string[];
    onreorder: (change: Reorder) => void | Promise<void>;
    disabled?: boolean;
    /** `listitem` inside a Sortable's `list`; a host that sits in its own list (the sidebar's `ul > li`) passes `presentation`. */
    role?: 'listitem' | 'presentation';
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLDivElement>, 'children'> = $props();

  let el = $state<HTMLElement | null>(null);
  const index = $derived(keys.indexOf(id));
  const line = 'before:absolute before:top-0 before:right-0 before:left-0 before:h-0.5 before:bg-primary';
  const lineAfter = 'after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-primary';

  // After a keyboard move the list re-renders and the browser drops focus; give it back once the key sits at its new place.
  let lastIndex = -1;
  let focused: HTMLElement | null = null; // what had focus when the key was pressed (the handle, or the entry's link)
  $effect(() => {
    const at = index;
    const moved = lastIndex >= 0 && at !== lastIndex;
    lastIndex = at;
    if (moved && sortable.focusKey === id) {
      (focused && el?.contains(focused)
        ? focused
        : el?.querySelector<HTMLElement>('[data-sortable-handle]')
      )?.focus();
      sortable.focusKey = null;
    }
  });

  function keydown(e: KeyboardEvent): void {
    if (disabled || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const onHandle = (e.target as HTMLElement).closest('[data-sortable-handle]') !== null;
    if (!onHandle && !e.altKey) return;
    e.preventDefault();
    focused = e.target as HTMLElement;
    const change = sortable.step(keys, id, e.key === 'ArrowUp' ? -1 : 1);
    if (change) void onreorder(change);
  }
</script>

<!-- A listitem that is not itself interactive: its handle (or, without one, its content) is the control. -->
<div
  bind:this={el}
  {role}
  draggable={!disabled}
  data-sortable-id={id}
  ondragstart={disabled ? undefined : (e) => sortable.start(e, id)}
  ondragover={disabled ? undefined : (e) => sortable.over(e, id)}
  ondragleave={disabled ? undefined : () => sortable.leave(id)}
  ondrop={disabled
    ? undefined
    : (e) => {
        const change = sortable.drop(e, keys);
        if (change) void onreorder(change);
      }}
  ondragend={() => sortable.end()}
  onkeydown={keydown}
  class={cn(
    'relative',
    sortable.dropKey === id && sortable.dropPos === 'before' && line,
    sortable.dropKey === id && sortable.dropPos === 'after' && lineAfter,
    sortable.dragKey === id && 'opacity-50',
    className,
  )}
  {...rest}
>
  {@render children?.()}
</div>
