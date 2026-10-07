<script lang="ts">
  import { copyText } from '../shared/clipboard';
  // v3 `task-canvas/TaskConfigSidebar.svelte`: the right pane of a selected task. A header (title, the
  // task's name and key, "Aufgabe löschen"), five tabs (Definition, Bedingungen, Formular [v3: Werkzeuge],
  // Ergebnisse, YAML) and the tab's body.
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { labelOf } from '../../shell/location';
  import ProvenanceMark from '../shared/ProvenanceMark.svelte';
  import { canReset, hidesInsteadOfDeletes, provenanceOf, resetOps } from '../shared/provenance';
  import { getBuilderContext } from '../shell/context';
  import { commitOps } from './commit';
  import ConditionsTab from './ConditionsTab.svelte';
  import ConfirmDelete from './ConfirmDelete.svelte';
  import DefinitionTab from './DefinitionTab.svelte';
  import FormTab from './FormTab.svelte';
  import OutcomesTab from './OutcomesTab.svelte';
  import { deleteOps, dependentRules } from './ops';
  import CopyFormButton from '../code/CopyFormButton.svelte';
  import { autoLabel, isSystemOnly } from '../rule/auto-task';
  import YamlTab from './YamlTab.svelte';

  const ctx = getBuilderContext();
  const t = $derived(ctx.t);

  const ALL_TABS = ['definition', 'conditions', 'form', 'outcomes', 'yaml'] as const;
  type Tab = (typeof ALL_TABS)[number];
  const tabLabel: Record<Tab, () => string> = {
    definition: () => t('tp_tab_definition'),
    conditions: () => t('tp_tab_conditions'),
    form: () => t('tp_tab_form'),
    outcomes: () => t('tp_tab_outcomes'),
    yaml: () => t('tp_tab_yaml'),
  };

  let tab: Tab = $state('definition');
  let confirmOpen = $state(false);
  let copied = $state(false);
  let error: string | undefined = $state();

  const doc = $derived(ctx.doc());
  const task = $derived(ctx.selection().kind === 'task' ? (ctx.selection().id ?? '') : '');
  const def = $derived(doc.effective().tasks?.[task]);
  const name = $derived(labelOf(def?.label, ctx.locale, task));
  // A task only the system runs is an automatic action (C-004): no form.
  const automatic = $derived(isSystemOnly(def));
  const TABS = $derived(ALL_TABS.filter((k) => !(automatic && k === 'form')));
  // Where the task comes from (WP-445): the mark, "Auf Vorlage zurücksetzen" when it is changed, and for a template
  // task "Ausblenden" in place of "Aufgabe löschen" (the delete of a template task is a `hide`).
  const info = $derived(provenanceOf(doc, [`tasks.${task}`]));
  const locked = $derived(info?.lock !== undefined);
  const hide = $derived(hidesInsteadOfDeletes(info));
  const impact = $derived(
    dependentRules(doc.effective(), task).map((k) => autoLabel(doc.effective(), k, ctx.locale)),
  );

  // A new selection opens on Definition, as in v3 (the pane is recreated per task).
  $effect(() => {
    void task;
    tab = 'definition';
    error = undefined;
  });

  async function copyKey(): Promise<void> {
    if (await copyText(task)) {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } else error = t('tp_key_copy_failed');
  }

  function reset(): void {
    error = commitOps(ctx, resetOps(doc, [`tasks.${task}`]), `tasks.${task}`);
  }

  function remove(): void {
    confirmOpen = false;
    const failed = commitOps(ctx, deleteOps(doc, task), `tasks.${task}`);
    if (failed === undefined) ctx.select({ kind: 'none' });
    else error = failed;
  }
</script>

{#if def === undefined}
  <p class="missing" role="status">{t('task_not_found')}</p>
{:else}
  <div class="pane" data-testid="task-pane" data-task={task}>
    <header class="head">
      <div class="head-row">
        <h2 class="title">{t('tp_title')}</h2>
        <Button
          variant="ghost"
          size="sm"
          class="delete"
          data-testid="task-delete"
          disabled={locked}
          onclick={() => (confirmOpen = true)}
        >
          <Trash2 class="mr-1 h-3.5 w-3.5" />
          {hide ? t('prov_hide') : t('tp_delete')}
        </Button>
      </div>
      <p class="name" data-testid="task-name" title={name}>{name}</p>
      <div class="key-row">
        {#if info !== undefined}
          <ProvenanceMark {t} {info} />
          {#if canReset(info)}
            <button
              type="button"
              class="copy"
              data-testid="task-reset"
              disabled={locked}
              title={info.lock === undefined ? undefined : t('prov_locked', { lock: info.lock })}
              onclick={reset}>{t('prov_reset')}</button
            >
          {/if}
        {/if}
        <code class="key" data-testid="task-key">{task}</code>
        <button type="button" class="copy" data-testid="task-copy-key" onclick={copyKey}>
          {#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
          <span aria-live="polite">{copied ? t('tp_key_copied') : t('tp_key_copy')}</span>
        </button>
      </div>
      {#if error !== undefined}<p class="error" role="alert">{error}</p>{/if}
    </header>

    <div class="tabs" role="tablist" aria-label={t('tp_title')}>
      {#each TABS as key (key)}
        <button
          type="button"
          role="tab"
          id={`task-tab-${key}`}
          aria-selected={tab === key}
          aria-controls={`task-panel-${key}`}
          class="tab-btn"
          class:active={tab === key}
          data-testid={`tab-${key}`}
          onclick={() => (tab = key)}
        >
          {tabLabel[key]()}
        </button>
      {/each}
    </div>

    <div class="body" role="tabpanel" id={`task-panel-${tab}`} aria-labelledby={`task-tab-${tab}`}>
      {#if tab === 'definition'}
        <DefinitionTab {ctx} {task} />
      {:else if tab === 'conditions'}
        <ConditionsTab {ctx} {task} />
      {:else if tab === 'yaml'}
        <CopyFormButton {ctx} {task} />
        <YamlTab {ctx} {task} />
      {:else if tab === 'form'}
        <FormTab {ctx} {task} />
      {:else}
        <OutcomesTab {ctx} {task} />
      {/if}
    </div>
  </div>

  <ConfirmDelete
    bind:open={confirmOpen}
    {t}
    title={t(hide ? 'tp_hide_title' : 'tp_delete_title', { name: name || t('tp_title') })}
    {hide}
    {impact}
    onconfirm={remove}
  />
{/if}

<style>
  .pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    font-size: 0.875rem;
    color: var(--foreground);
  }
  .head {
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .head :global(.delete) {
    height: 1.75rem;
    padding: 0 0.5rem;
    color: var(--muted-foreground);
  }
  .head :global(.delete:hover) {
    color: var(--destructive);
  }
  .name {
    margin: 0.5rem 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .key-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .key {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.375rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .copy:hover {
    color: var(--foreground);
    background: var(--accent);
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.375rem 0.5rem;
    overflow-x: auto;
    font-size: 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .tab-btn {
    flex-shrink: 0;
    padding: 0.25rem 0.5rem;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .tab-btn:hover {
    color: var(--foreground);
  }
  .tab-btn.active {
    font-weight: 500;
    color: var(--foreground);
    background: var(--accent);
  }
  .body {
    flex: 1;
    min-height: 0;
    padding: 0.75rem;
    overflow-y: auto;
  }
  .missing {
    margin: 1rem;
    font-size: 0.8125rem;
    font-style: italic;
    color: var(--muted-foreground);
  }
  .error {
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    color: var(--destructive);
  }
  @media (max-width: 640px) {
    .tab-btn {
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
    }
    .copy {
      padding: 0.5rem;
    }
  }
</style>
