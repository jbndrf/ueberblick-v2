<script lang="ts">
  import type { SheetProps } from '../contract';
  import { m } from '../paraglide/messages.js';
  import { iconClose } from '../icons';
  import IconButton from './IconButton.svelte';

  let { open, title, onclose, children }: SheetProps = $props();

  const uid = $props.id();
  const titleId = `ub-sheet-${uid}`;
  let dialog: HTMLElement | undefined = $state();
  let opener: HTMLElement | null = null;

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  // Focus goes into the sheet on open and back to the opener on close.
  $effect(() => {
    if (!open || !dialog) return;
    opener = document.activeElement as HTMLElement | null;
    dialog.focus();
    return () => opener?.focus();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
      return;
    }
    if (e.key !== 'Tab' || !dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events: Escape and the close button are the keyboard paths -->
  <div class="backdrop" data-testid="sheet-backdrop" role="presentation" onclick={onclose}></div>
  <div
    bind:this={dialog}
    class="ub-sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    {onkeydown}
  >
    <div class="head">
      <h2 id={titleId}>{title}</h2>
      <IconButton icon={iconClose} label={m.ui_close()} onclick={onclose} />
    </div>
    <div class="body">{@render children()}</div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--ub-color-scrim);
  }
  .ub-sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 85vh;
    overflow: auto;
    box-sizing: border-box;
    padding: var(--ub-space-md);
    background: var(--ub-color-bg);
    color: var(--ub-color-text);
    border-radius: var(--ub-radius-lg) var(--ub-radius-lg) 0 0;
    box-shadow: var(--ub-elevation-overlay);
    font: var(--ub-type-weight-normal) var(--ub-type-size-md) / var(--ub-type-line-height)
      var(--ub-type-family);
  }
  .ub-sheet:focus {
    outline: none;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ub-space-md);
  }
  h2 {
    margin: 0;
    font-size: var(--ub-type-size-lg);
  }
</style>
