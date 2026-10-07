<script lang="ts">
  // v3 `DataTabsSection.svelte:94-140`: the tab strip with the "+" ("Tab hinzufügen"), and for a tab the admin made its
  // name (click to rename) and delete. Deleting a tab asks first and says what happens to its fields.
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import type { Translate } from '../../shell/messages';
  import { HUB_DEFAULT_TAB } from '../model/fields/hub';
  import InlineEdit from '../shared/InlineEdit.svelte';

  interface Props {
    t: Translate;
    names: readonly string[];
    active: string;
    label: (name: string) => string;
    /** The active tab is one the admin made (the default tab cannot be renamed or deleted). */
    isCustom: boolean;
    confirming: boolean;
    /** A property is being dragged: the tabs show they are drop targets. */
    dropping: boolean;
    onactivate: (name: string) => void;
    onadd: () => void;
    onrename: (name: string) => void;
    onaskdelete: () => void;
    onremove: () => void;
    oncancel: () => void;
  }
  let {
    t,
    names,
    active,
    label,
    isCustom,
    confirming,
    dropping,
    onactivate,
    onadd,
    onrename,
    onaskdelete,
    onremove,
    oncancel,
  }: Props = $props();
</script>

<div class="tab-strip">
  <div class="tab-list" role="tablist" aria-label={t('stage_tabs')}>
    {#each names as name, i (name)}
      <button
        type="button"
        role="tab"
        class="tab-chip"
        class:active={name === active}
        class:drop-target={dropping}
        aria-selected={name === active}
        data-tab={name === HUB_DEFAULT_TAB ? 'default' : name}
        onclick={() => onactivate(name)}
        data-dest={JSON.stringify({ kind: 'page', page: i })}
      >
        {label(name)}
      </button>
    {/each}
  </div>
  <button
    type="button"
    class="tab-add"
    title={t('stage_tab_add')}
    aria-label={t('stage_tab_add')}
    onclick={onadd}
  >
    <Plus size={14} />
  </button>
</div>

{#if isCustom && active !== HUB_DEFAULT_TAB}
  <div class="tab-header">
    <InlineEdit
      value={active}
      oncommit={onrename}
      class="tab-name"
      ariaLabel={t('stage_tab_name')}
      editTitle={t('stage_edit_name')}
    />
    <button
      type="button"
      class="tab-delete"
      title={t('stage_tab_delete')}
      aria-label={t('stage_tab_delete')}
      onclick={onaskdelete}
    >
      <X size={14} />
    </button>
  </div>
{/if}

{#if confirming}
  <div
    class="confirm"
    role="alertdialog"
    aria-label={t('stage_tab_delete')}
    data-testid="stage-tab-delete-confirm"
  >
    <p>{t('stage_tab_delete_confirm', { name: active })}</p>
    <div class="row">
      <button type="button" class="danger" data-testid="stage-tab-delete-yes" onclick={onremove}>
        {t('stage_tab_delete_yes')}
      </button>
      <button type="button" class="ghost" onclick={oncancel}>{t('stage_cancel')}</button>
    </div>
  </div>
{/if}

<style>
  .tab-strip,
  .tab-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
  }
  .tab-chip {
    font-size: 0.75rem;
    min-height: 2rem;
    padding: 0.3rem 0.7rem;
    border-radius: 0.5rem 0.5rem 0 0;
    border: 1px solid var(--border);
    border-bottom: none;
    background: color-mix(in srgb, var(--muted) 40%, transparent);
    color: var(--muted-foreground);
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .tab-chip:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  .tab-chip.active {
    background: var(--background);
    color: var(--foreground);
    font-weight: 600;
  }
  .tab-chip.drop-target:not(.active) {
    outline: 1px dashed var(--ring, var(--border));
  }
  .tab-add,
  .tab-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.375rem;
    background: transparent;
    cursor: pointer;
  }
  .tab-add {
    border: 1px dashed var(--border);
    color: var(--muted-foreground);
  }
  .tab-add:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  .tab-delete {
    border: 1px solid var(--border);
    color: var(--destructive);
  }
  .tab-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .tab-header :global(.tab-name) {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    border-bottom: 1px solid transparent;
    background: transparent;
    color: var(--foreground);
    font-size: 0.875rem;
    font-weight: 600;
    text-align: left;
    cursor: text;
    outline: none;
  }
  .tab-header :global(.tab-name:hover),
  .tab-header :global(.tab-name:focus) {
    border-bottom-color: var(--border);
  }
  .confirm {
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--muted);
    font-size: 0.8125rem;
  }
  .confirm p {
    margin: 0 0 0.5rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .row button {
    min-height: 2rem;
    padding: 0.25rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .danger {
    border: 0;
    background: var(--destructive);
    color: var(--destructive-foreground, white);
  }
  .ghost {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--foreground);
  }
</style>
