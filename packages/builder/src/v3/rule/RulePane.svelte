<script lang="ts">
  import { copyText } from '../shared/clipboard';
  // v3 `task-canvas/AutomationConfig.svelte`: the right pane of a selected automatic action. A header (title, "Regel (glossary-lint-ignore: v3 file name)
  // löschen", the name field), tabs (v3: Definition, Auslöser, Schritte, YAML) and the tab's body. v3's
  // Definition tab held one hint, which now opens the Auslöser tab; the YAML tab is the Code view's
  // per-entity YAML (S4-17). Key and "Schlüssel kopieren" are as in the task pane.
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { labelOf } from '../../shell/location';
  import { getBuilderContext } from '../shell/context';
  import ProvenanceMark from '../shared/ProvenanceMark.svelte';
  import { canReset, hidesInsteadOfDeletes, provenanceOf, resetOps } from '../shared/provenance';
  import { ELEMENT_KINDS, elementPaths } from '../shared/provenance-elements';
  import ConfirmDelete from '../task/ConfirmDelete.svelte';
  import { localizedText } from '../task/ops';
  import ConditionTab from './ConditionTab.svelte';
  import { commitRuleOps } from './commit';
  import { deleteOps, labelOps } from './ops';
  import { autoAt, autoLabel, autoOf, ownsTask } from './auto-task';
  import StepsTab from './StepsTab.svelte';
  import TriggerTab from './TriggerTab.svelte';

  const ctx = getBuilderContext();

  const t = $derived(ctx.t);
  // The same two sections as the task pane (C-004): Bedingung (when it fires, then its condition), Ergebnis.
  const TABS = ['condition', 'steps'] as const;
  type Tab = (typeof TABS)[number];
  const tabLabel: Record<Tab, () => string> = {
    condition: () => t('rp_tab_condition'),
    steps: () => t('rp_tab_steps'),
  };

  let tab: Tab = $state('condition');
  let confirmOpen = $state(false);
  let copied = $state(false);
  let error: string | undefined = $state();

  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const rule = $derived(ctx.selection().kind === 'rule' ? (ctx.selection().id ?? '') : '');
  const auto = $derived(autoOf(file, rule));
  const def = $derived(auto?.entry);
  const name = $derived(autoLabel(file, rule, ctx.locale));
  const own = $derived(def !== undefined && ownsTask(file, rule));
  // Where the rule comes from (WP-454, as the task pane): the mark, "Auf Vorlage zurücksetzen" when it is changed, and
  // for a template rule "Ausblenden" in place of "Regel löschen" (the delete of a template rule is a `hide`).
  const paths = $derived(elementPaths(doc, ctx.type, { kind: ELEMENT_KINDS.rule, key: rule }));
  const info = $derived(provenanceOf(doc, paths));
  const locked = $derived(info?.lock !== undefined);
  const hide = $derived(hidesInsteadOfDeletes(info));
  const impact = $derived(
    own && auto !== undefined ? [labelOf(file.tasks?.[auto.task]?.label, ctx.locale, auto.task)] : [],
  );

  // A new selection opens on the Bedingung, whose first part is v3's Auslöser (the pane is recreated per rule).
  $effect(() => {
    void rule;
    tab = 'condition';
    error = undefined;
  });

  async function copyKey(): Promise<void> {
    if (await copyText(rule)) {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } else error = t('tp_key_copy_failed');
  }

  function reset(): void {
    error = commitRuleOps(ctx, resetOps(doc, paths), paths);
  }

  function remove(): void {
    confirmOpen = false;
    const run = auto?.task;
    const failed = commitRuleOps(ctx, deleteOps(doc, rule), [
      autoAt(rule),
      ...(run === undefined ? [] : [`tasks.${run}`]),
    ]);
    if (failed === undefined) ctx.select({ kind: 'none' });
    else error = failed;
  }
</script>

{#if def === undefined}
  <p class="missing" role="status">{t('rp_not_found')}</p>
{:else}
  <div class="pane" data-testid="rule-pane" data-rule={rule}>
    <header class="head">
      <div class="head-row">
        <h2 class="title">{t('rp_title')}</h2>
        <Button
          variant="ghost"
          size="sm"
          class="delete"
          data-testid="rule-delete"
          disabled={locked}
          onclick={() => (confirmOpen = true)}
        >
          <Trash2 class="mr-1 h-3.5 w-3.5" />
          {hide ? t('prov_hide') : t('rp_delete')}
        </Button>
      </div>
      <Input
        class="name"
        data-testid="rule-name"
        aria-label={t('rp_title')}
        placeholder={t('rp_name_placeholder')}
        value={localizedText(def.label, ctx.locale)}
        onchange={(e) => {
          const text = e.currentTarget.value;
          if (text.trim() === '') e.currentTarget.value = localizedText(def.label, ctx.locale);
          else error = commitRuleOps(ctx, labelOps(doc, rule, ctx.locale, text), [autoAt(rule)]);
        }}
      />
      <div class="key-row">
        {#if info !== undefined}
          <ProvenanceMark {t} {info} />
          {#if canReset(info)}
            <button
              type="button"
              class="copy"
              data-testid="rule-reset"
              disabled={locked}
              title={info.lock === undefined ? undefined : t('prov_locked', { lock: info.lock })}
              onclick={reset}>{t('prov_reset')}</button
            >
          {/if}
        {/if}
        <code class="key" data-testid="rule-key" title={name}>{rule}</code>
        <button type="button" class="copy" data-testid="rule-copy-key" onclick={copyKey}>
          {#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
          <span aria-live="polite">{copied ? t('tp_key_copied') : t('tp_key_copy')}</span>
        </button>
      </div>
      {#if error !== undefined}<p class="error" role="alert" data-testid="rule-pane-error">{error}</p>{/if}
    </header>

    <div class="tabs" role="tablist" aria-label={t('rp_title')}>
      {#each TABS as key (key)}
        <button
          type="button"
          role="tab"
          id={`rule-tab-${key}`}
          aria-selected={tab === key}
          aria-controls={`rule-panel-${key}`}
          class="tab-btn"
          class:active={tab === key}
          data-testid={`rule-tab-btn-${key}`}
          onclick={() => (tab = key)}
        >
          {tabLabel[key]()}
        </button>
      {/each}
    </div>

    <div class="body" role="tabpanel" id={`rule-panel-${tab}`} aria-labelledby={`rule-tab-${tab}`}>
      {#if tab === 'condition'}
        <TriggerTab {ctx} {rule} />
        <ConditionTab {ctx} {rule} />
      {:else}
        <StepsTab {ctx} {rule} />
      {/if}
    </div>
  </div>

  <ConfirmDelete
    bind:open={confirmOpen}
    {t}
    title={t(hide ? 'rp_hide_title' : 'rp_delete_title', { name: name || t('rp_title') })}
    {hide}
    hideBody={t('rp_hide_body')}
    impact={hide ? [] : impact}
    impactLead={t('rp_delete_impact')}
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
    margin-bottom: 0.5rem;
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
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
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
