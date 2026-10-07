<script lang="ts">
  // The action bar of a field card: remove and the "⋯" menu. Order, width and pages are set by drag and drop only
  // (owner 2026-10-05, WP-1053). The card shows the bar on hover, on the selected card and always on a touch screen.
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { Translate } from '../../shell/messages';
  import CardMenu from './CardMenu.svelte';
  import type { FieldView } from './model';

  interface Props {
    t: Translate;
    view: FieldView;
    protectedKey: boolean;
    /** The "⋯" menu is open (a right click on the card opens it too). */
    menu: boolean;
    onremove: () => void;
    ondelete: () => void;
  }
  let { t, view, protectedKey, menu = $bindable(), onremove, ondelete }: Props = $props();
</script>

<!-- The buttons in the bar have the keyboard; this click only keeps a click on the bar from selecting the card. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="bar"
  role="toolbar"
  tabindex="-1"
  aria-label={view.label}
  data-testid="field-bar"
  onclick={(e) => e.stopPropagation()}
>
  <span class="grow"></span>
  <button
    type="button"
    class="icon-btn remove"
    aria-label={t('form_card_remove', { label: view.label })}
    data-testid="field-remove"
    onclick={(e) => {
      e.stopPropagation();
      onremove();
    }}><Trash2 size={16} /></button
  >
  <CardMenu {t} label={view.label} keyName={view.key} bind:open={menu} {protectedKey} {onremove} {ondelete} />
</div>

<style>
  .bar {
    display: none;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.125rem;
    margin-top: 0.5rem;
    padding-top: 0.375rem;
    border-top: 1px solid var(--border);
  }
  @media (pointer: coarse) {
    .bar {
      display: flex;
    }
  }
  .grow {
    flex: 1;
  }
  .bar :global(.icon-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .bar :global(.icon-btn):hover:not(:disabled) {
    color: var(--foreground);
    background: var(--muted);
  }
  .bar :global(.icon-btn).remove:hover:not(:disabled) {
    color: var(--destructive);
  }
  .bar :global(.icon-btn):disabled {
    opacity: 0.3;
    cursor: default;
  }
  @media (max-width: 767px), (pointer: coarse) {
    .bar :global(.icon-btn) {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
</style>
