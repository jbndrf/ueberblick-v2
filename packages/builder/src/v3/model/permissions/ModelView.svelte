<script lang="ts">
  // v3 `ModelOverviewView.svelte`: the Modell view is a hub of sub-tabs over the Objektart's data model: Felder (the
  // Daten layout, FieldHub), Berechtigungen (the matrix) and Aufgaben (the task table). A tab is one entry of `TABS`:
  // a later one needs no other change here. Felder and Aufgaben sit in v3's centred card; the matrix is full-bleed.
  import type { Component } from 'svelte';
  import type { MessageKey } from '../../../shell/messages';
  import { getBuilderContext } from '../../shell/context';
  import FieldHub from '../fields/FieldHub.svelte';
  import TasksTable from '../tasks/TasksTable.svelte';
  import PermissionsMatrixView from './PermissionsMatrixView.svelte';

  const t = getBuilderContext().t;

  interface Tab {
    readonly key: string;
    readonly label: MessageKey;
    readonly view: Component;
    /** v3's centred card (`sub-content centered`) against the full-bleed matrix. */
    readonly card: boolean;
  }
  /** v3's order: Felder first, the default; then Berechtigungen, then Aufgaben. */
  const TABS: readonly Tab[] = [
    { key: 'fields', label: 'model_tab_fields', view: FieldHub, card: true },
    { key: 'permissions', label: 'model_tab_permissions', view: PermissionsMatrixView, card: false },
    { key: 'tasks', label: 'model_tab_tasks', view: TasksTable, card: true },
  ];
  let sub = $state(TABS[0]?.key ?? '');
  const active = $derived(TABS.find((x) => x.key === sub));
</script>

<div class="model-view" data-testid="model-view">
  <div class="sub-tabs" role="tablist" aria-label={t('model_tabs')}>
    {#each TABS as tab (tab.key)}
      <button
        type="button"
        role="tab"
        id={`model-tab-${tab.key}`}
        aria-selected={sub === tab.key}
        aria-controls={`model-panel-${tab.key}`}
        class="sub-tab"
        class:active={sub === tab.key}
        onclick={() => (sub = tab.key)}
      >
        {t(tab.label)}
      </button>
    {/each}
  </div>
  <div
    class="sub-content"
    class:centered={active?.card}
    role="tabpanel"
    id={`model-panel-${sub}`}
    aria-labelledby={`model-tab-${sub}`}
  >
    {#if active !== undefined}
      {@const Active = active.view}
      {#if active.card}
        <section class="card" aria-label={t(active.label)}>
          <h2 class="card-title">{t(active.label)}</h2>
          <Active />
        </section>
      {:else}
        <Active />
      {/if}
    {/if}
  </div>
</div>

<style>
  .model-view {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    flex-direction: column;
  }
  .sub-tabs {
    display: flex;
    flex-shrink: 0;
    gap: 0.25rem;
    padding: 0 1rem;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .sub-tab {
    margin-bottom: -1px;
    padding: 0.625rem 0.875rem;
    border-bottom: 2px solid transparent;
    background: transparent;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--muted-foreground);
    cursor: pointer;
    white-space: nowrap;
  }
  .sub-tab:hover {
    color: var(--foreground);
  }
  .sub-tab.active {
    border-bottom-color: var(--primary);
    color: var(--foreground);
  }
  .sub-tab:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .sub-content {
    display: flex;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }
  .sub-content.centered {
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 980px;
    margin: 0 auto;
    padding: 1rem;
  }
  .card {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--card);
  }
  .card-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--foreground);
  }
</style>
