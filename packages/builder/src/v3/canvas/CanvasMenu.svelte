<script lang="ts">
  // v3 `workflow-builder/components/Deletable.svelte`: the right-click menu of a canvas element. The kit has no
  // context menu (and the kit's dropdown menu closes itself when it is opened by the very pointer that is still
  // pressed), so this is a small menu at the pointer: role "menu", arrow keys, Home/End, Escape and Tab close it,
  // a press outside closes it, focus goes back to the element. The browser fires `contextmenu` for the context key
  // and Shift+F10 too, so the keyboard reaches it.
  import { tick } from 'svelte';
  import type { MenuState } from './state.svelte';

  interface Props {
    menu: MenuState | undefined;
    onclose: () => void;
  }
  let { menu, onclose }: Props = $props();

  let el: HTMLElement | undefined = $state();

  function close(): void {
    const back = menu?.returnTo;
    onclose();
    back?.focus();
  }

  $effect(() => {
    if (menu === undefined) return;
    void tick().then(() => el?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    // A press outside closes it; the right button that opened it must not (it can reopen on another element).
    const outside = (e: PointerEvent): void => {
      if (e.button === 2 || el?.contains(e.target as Node)) return;
      onclose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  });

  function onkeydown(e: KeyboardEvent): void {
    const items = [...(el?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number): void => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') close();
  }
</script>

{#if menu}
  <div
    bind:this={el}
    class="canvas-menu"
    role="menu"
    tabindex="-1"
    aria-label={menu.label}
    data-testid="canvas-menu"
    style="left: {menu.x}px; top: {menu.y}px"
    {onkeydown}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each menu.items as item (item.label)}
      <button
        type="button"
        role="menuitem"
        class="canvas-menu-item"
        class:destructive={item.destructive === true}
        disabled={item.disabled === true}
        aria-disabled={item.disabled === true}
        onclick={() => {
          const run = item.run;
          close();
          run();
        }}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .canvas-menu {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    min-width: 12rem;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--popover);
    color: var(--popover-foreground);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
  }
  .canvas-menu-item {
    padding: 0.375rem 0.5rem;
    border: 0;
    border-radius: 0.25rem;
    background: none;
    font: inherit;
    font-size: 0.875rem;
    color: inherit;
    text-align: left;
    cursor: default;
  }
  .canvas-menu-item:hover,
  .canvas-menu-item:focus-visible {
    outline: none;
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .canvas-menu-item:disabled {
    opacity: 0.5;
  }
  .canvas-menu-item.destructive {
    color: var(--destructive);
  }
  .canvas-menu-item.destructive:hover,
  .canvas-menu-item.destructive:focus-visible {
    background: color-mix(in oklab, var(--destructive) 10%, transparent);
  }
</style>
