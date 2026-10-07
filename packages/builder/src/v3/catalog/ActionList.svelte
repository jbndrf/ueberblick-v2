<script lang="ts">
  // The catalog's one list of actions (C-004, owner 2026-10-05; v3 had a task list and a separate list of rules,
  // `CatalogSidebar.svelte:131-166`). An action is carried out by people (a task) or automatically (an automatic
  // action: a rule with its own task, or a task only the system runs). The chips filter: Alle, Personen, Automatisch.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import LogIn from '@lucide/svelte/icons/log-in';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import Zap from '@lucide/svelte/icons/zap';
  import HiddenRow from './HiddenRow.svelte';
  import type { Translate } from '../../shell/messages';
  import type { Selection } from '../shell/registry';
  import { ACTION_FILTERS, actionRows, type ActionFilter } from './actions';
  import { TASK_BADGES, type Inventory } from './inventory';

  interface Props {
    inventory: Inventory;
    t: Translate;
    selected: Selection;
    onselect: (selection: Selection) => void;
    onunhide: (path: string) => void;
    open: boolean;
  }
  let { inventory, t, selected, onselect, onunhide, open = $bindable() }: Props = $props();

  let filter = $state<ActionFilter>(ACTION_FILTERS.all);
  const rows = $derived(actionRows(inventory, filter));
  const hidden = $derived(actionRows(inventory, filter, true));

  const filterLabel: Record<ActionFilter, () => string> = {
    [ACTION_FILTERS.all]: () => t('catalog_filter_all'),
    [ACTION_FILTERS.people]: () => t('catalog_filter_people'),
    [ACTION_FILTERS.automatic]: () => t('catalog_filter_automatic'),
  };
  const filterName: Record<ActionFilter, () => string> = {
    [ACTION_FILTERS.all]: () => t('catalog_filter_all_name'),
    [ACTION_FILTERS.people]: () => t('catalog_filter_people_name'),
    [ACTION_FILTERS.automatic]: () => t('catalog_filter_automatic_name'),
  };
  const badgeText = (row: Inventory['tasks'][number]): string =>
    row.badge === TASK_BADGES.entry
      ? t('catalog_badge_entry')
      : row.badge === TASK_BADGES.many
        ? t('catalog_badge_many')
        : row.stages.join(', ');
</script>

<section class="catalog-section" data-testid="catalog-actions">
  <button type="button" class="section-toggle" aria-expanded={open} onclick={() => (open = !open)}>
    {#if open}<ChevronDown class="section-chevron" />{:else}<ChevronRight class="section-chevron" />{/if}
    <h3 class="section-title">{t('catalog_actions')}</h3>
    <span class="section-count" data-testid="catalog-count-actions"
      >{inventory.tasks.length + inventory.rules.length}</span
    >
  </button>
  {#if open}
    <div class="filter" role="group" aria-label={t('catalog_filter_label')}>
      {#each Object.values(ACTION_FILTERS) as f (f)}
        <button
          type="button"
          class="filter-chip"
          aria-pressed={filter === f}
          aria-label={filterName[f]()}
          data-testid="catalog-filter-{f}"
          onclick={() => (filter = f)}>{filterLabel[f]()}</button
        >
      {/each}
    </div>
    {#if rows.length === 0 && hidden.length === 0}
      <p class="section-hint empty">{t('catalog_actions_empty')}</p>
    {:else}
      <div class="item-list">
        {#each rows as row (`${row.kind}:${row.key}`)}
          <button
            type="button"
            class="list-item"
            class:selected={selected.kind === row.kind && selected.id === row.key}
            data-path={row.path}
            data-action={row.automatic ? 'automatic' : 'people'}
            onclick={() => onselect({ kind: row.kind, id: row.key })}
          >
            {#if row.automatic}
              <Zap class="item-icon" />
            {:else if row.badge === TASK_BADGES.entry}
              <LogIn class="item-icon" />
            {:else}
              <MousePointerClick class="item-icon" />
            {/if}
            <span class="item-label">{row.label}</span>
            {#if row.trigger !== undefined}
              <span class="item-meta">{t(`catalog_trigger_${row.trigger}`)}</span>
            {:else if row.task !== undefined && row.task.badge !== undefined}
              <span class="scope-badge">{badgeText(row.task)}</span>
            {/if}
          </button>
        {/each}
        {#each hidden as row (`${row.kind}:${row.key}`)}
          <HiddenRow
            label={row.label}
            path={row.path}
            icon={row.automatic ? Zap : row.badge === TASK_BADGES.entry ? LogIn : MousePointerClick}
            {t}
            {onunhide}
          />
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .filter {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .filter-chip {
    padding: 0.15rem 0.5rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--foreground);
    font-size: 0.6875rem;
    cursor: pointer;
  }
  .filter-chip[aria-pressed='true'] {
    background: var(--accent);
    border-color: color-mix(in oklab, var(--primary) 40%, transparent);
    font-weight: 600;
  }
</style>
