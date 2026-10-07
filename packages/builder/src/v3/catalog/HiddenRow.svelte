<script lang="ts">
  // A template element the project hides (WP-452): listed greyed at the end of its inventory; "Einblenden" is the
  // ordinary `unhide` op, raised through `onunhide` (the frame owns the document).
  import type { Component } from 'svelte';
  import type { Translate } from '../../shell/messages';

  interface Props {
    label: string;
    path: string;
    icon: Component;
    t: Translate;
    onunhide: (path: string) => void;
  }
  let { label, path, icon, t, onunhide }: Props = $props();
  const Lead = $derived(icon);
</script>

<div class="hidden-item" data-path={path} data-hidden="true">
  <Lead class="item-icon" />
  <span class="item-label">{label}</span>
  <button type="button" class="unhide" onclick={() => onunhide(path)}>{t('catalog_unhide')}</button>
</div>

<style>
  .hidden-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    width: 100%;
    opacity: 0.6;
    font-style: italic;
  }
  .hidden-item :global(.item-icon) {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .item-label {
    flex: 1;
    font-size: 0.8125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .unhide {
    flex-shrink: 0;
    font-size: 0.625rem;
    font-weight: 600;
    font-style: normal;
    padding: 0.1rem 0.45rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--foreground);
    cursor: pointer;
  }
  .unhide:hover {
    background: var(--accent);
  }
</style>
