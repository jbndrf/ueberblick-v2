<script lang="ts">
  // v3 `TaskConfigSidebar.svelte:423-444`, the Ergebnisse tab: "Übergang zu" (a select of the stages, "Kein
  // Übergang"), the note on the YAML tab, then `EffectListEditor` (the action list and its add buttons).
  // "Übergang zu" is the `then` step the canvas draws as an arrow (one op with the process lens, R1). v3's
  // `create_instance` is the task's `creates` (at most one); v3's `snapshot` has no engine home (E10).
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { BuilderContext } from '../shell/context';
  import { commitOps } from './commit';
  import OutcomeRow from './OutcomeRow.svelte';
  import {
    ADD_REFUSALS,
    addOutcomeOps,
    createTypeOps,
    outcomeRows,
    removeCreateOps,
    TRANSITION_REFUSALS,
    transitionOps,
    transitionTarget,
    type AddableOutcome,
  } from './outcome-ops';
  import { stageSourceOf } from './ops';

  interface Props {
    ctx: BuilderContext;
    task: string;
  }
  let { ctx, task }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const def = $derived(file.tasks?.[task]);
  const scope = $derived(`tasks.${task}`);
  const source = $derived(stageSourceOf(file, task, ctx.type));
  const stages = $derived(
    Object.entries(
      source === undefined ? {} : (file.types?.[source.type]?.properties[source.property]?.options ?? {}),
    ).map(([key, l]) => ({ key, name: labelOf(l, ctx.locale, key) })),
  );
  const target = $derived(transitionTarget(file, task, ctx.type) ?? '');
  const rows = $derived(outcomeRows(file, task, ctx.type));
  const types = $derived(
    Object.entries(file.types ?? {}).map(([key, d]) => ({ key, name: labelOf(d.label, ctx.locale, key) })),
  );
  const entry = $derived(def?.on === '$map');

  let error: string | undefined = $state();

  const commit = (ops: readonly Op[], at: string): string | undefined => commitOps(ctx, ops, at);
  function write(ops: readonly Op[]): void {
    error = commit(ops, scope);
  }

  const REFUSALS = {
    [TRANSITION_REFUSALS.noProcess]: 'oc_no_process',
    [TRANSITION_REFUSALS.pinned]: 'oc_transition_pinned',
  } as const;

  function chooseTarget(to: string): void {
    const r = transitionOps(doc, task, ctx.type, to === '' ? undefined : to);
    error = r.ok ? commit(r.ops, scope) : t(REFUSALS[r.reason]);
  }

  const ADDS = [
    ['set', 'oc_kind_set'],
    ['clear', 'oc_kind_clear'],
    ['status', 'oc_kind_status'],
    ['create', 'oc_kind_create'],
    ['lifecycle', 'oc_kind_lifecycle'],
  ] as const satisfies readonly (readonly [AddableOutcome, string])[];

  const ADD_MESSAGES = {
    [ADD_REFUSALS.secondCreate]: 'oc_second_create',
    [ADD_REFUSALS.noProperty]: 'oc_no_property',
    [ADD_REFUSALS.noSelect]: 'oc_no_select',
  } as const;

  function add(kind: AddableOutcome): void {
    const r = addOutcomeOps(doc, task, ctx.type, kind);
    error = r.ok ? commit(r.ops, scope) : t(ADD_MESSAGES[r.reason]);
  }
</script>

<div class="tab" data-testid="task-tab-outcomes">
  <span class="heading">{t('tp_tab_outcomes')}</span>
  <label class="field">
    <span class="caption">{t('oc_transition')}</span>
    <select
      class="select"
      data-testid="outcome-transition"
      value={target}
      disabled={source === undefined}
      onchange={(e) => chooseTarget(e.currentTarget.value)}
    >
      <option value="">{t('oc_transition_none')}</option>
      {#each stages as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
    </select>
    {#if source === undefined}<span class="hint">{t('catalog_no_process')}</span>{/if}
  </label>
  <p class="hint">{t('tp_advanced_note')}</p>
  {#if error !== undefined}<p class="error" role="alert" data-testid="outcome-error">{error}</p>{/if}

  {#if def?.creates === undefined && rows.length === 0}
    <p class="empty" data-testid="outcomes-empty">{t('oc_empty')}</p>
  {/if}
  <ul class="effects" data-testid="outcomes">
    {#if def?.creates !== undefined}
      <li class="effect" data-testid="outcome-create" data-kind="create">
        <div class="head">
          <span class="title">{t('oc_kind_create')}</span>
          <span class="spacer"></span>
          <button
            type="button"
            class="icon-btn remove"
            aria-label={t('oc_remove_create')}
            title={entry ? t('oc_create_entry') : t('oc_remove_title')}
            disabled={entry}
            data-testid="outcome-create-remove"
            onclick={() => write(removeCreateOps(doc, task))}><Trash2 size={16} /></button
          >
        </div>
        <select
          class="select"
          aria-label={t('oc_create_type')}
          data-testid="outcome-create-type"
          value={def.creates}
          disabled={entry}
          onchange={(e) => write(createTypeOps(doc, task, e.currentTarget.value))}
        >
          {#each types as ty (ty.key)}<option value={ty.key}>{ty.name}</option>{/each}
        </select>
        <p class="hint">{entry ? t('oc_create_entry') : t('oc_create_hint')}</p>
      </li>
    {/if}
    {#each rows as r, at (r.index)}
      <OutcomeRow {ctx} {task} {rows} {at} {write} {commit} />
    {/each}
  </ul>

  <div class="adds">
    {#each ADDS as [kind, label] (kind)}
      <Button variant="outline" size="sm" data-testid={`add-${kind}`} onclick={() => add(kind)}>
        <Plus class="mr-1 h-3 w-3" />{t(label)}
      </Button>
    {/each}
  </div>
</div>

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .heading {
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .caption,
  .hint,
  .empty {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .empty {
    font-style: italic;
  }
  .select {
    min-width: 0;
    height: 2.25rem;
    padding: 0 0.5rem;
    font-size: 0.875rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  .effects {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .effect {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.5rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .title {
    font-size: 0.75rem;
    font-weight: 500;
  }
  .spacer {
    flex: 1;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) {
    color: var(--destructive);
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .adds {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
  @media (max-width: 640px) {
    .select {
      height: 2.75rem;
      font-size: 1rem;
    }
    .icon-btn {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
</style>
