<script lang="ts">
  // v3 `EffectListEditor.svelte:57-181`, one effect of the action list: its kind as a title, the controls
  // of that kind (property select, value or expression, status select, the lifecycle select) and a remove
  // button. New here, as the work package names: "nur wenn …" / "sonst" on every row (the step's `when` and
  // `otherwise`), and up/down (v3's list had no order controls; the steps run in this order).
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { LIFECYCLE_STATES, type LifecycleState, type Property } from '@ueberblick/core';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { BuilderContext } from '../shell/context';
  import ConditionRows from './ConditionRows.svelte';
  import {
    moveOutcomeOps,
    removeOutcomeOps,
    setLifecycleOps,
    setPropertyOps,
    setStepWhenOps,
    setValueOps,
    whenModeOf,
    WHEN_MODES,
    type OutcomeRow,
    type WhenMode,
  } from './outcome-ops';
  import { stepPathOptions } from './paths';
  import { subjectTypeOf } from './step-ops';
  import ValueInput from './ValueInput.svelte';

  interface Props {
    ctx: BuilderContext;
    task: string;
    rows: readonly OutcomeRow[];
    /** This row's place in `rows`. */
    at: number;
    /** Writes the ops; the reason it failed shows at the top of the tab. */
    write: (ops: readonly Op[]) => void;
    /** Writes the ops; returns the reason it failed, for a control that shows it in place. */
    commit: (ops: readonly Op[], scope: string) => string | undefined;
  }
  let { ctx, task, rows, at, write, commit }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const row = $derived(rows[at] as OutcomeRow);
  const step = $derived(row.step);
  const id = $derived(`outcome-${row.index}`);
  const properties = $derived(
    Object.entries(file.types?.[subjectTypeOf(file, task, ctx.type)]?.properties ?? {}) as [
      string,
      Property,
    ][],
  );
  const choices = $derived(
    row.kind === 'status' ? properties.filter(([, p]) => p.type === 'select') : properties,
  );
  const key = $derived(Object.keys(step.set ?? {})[0] ?? '');
  const value = $derived(step.set?.[key]);
  const options = $derived(Object.entries(properties.find(([k]) => k === key)?.[1].options ?? {}));
  const mode = $derived(whenModeOf(step));
  const paths = $derived(
    stepPathOptions(file, task, ctx.locale, t('tp_path_actor'), (name) => t('oc_form_field', { name })),
  );
  const lifecycle = $derived(step.lifecycle);
  // "nur wenn" shows its rows as soon as it is chosen, before a first condition exists.
  let opened = $state(false);
  const showRows = $derived(mode === 'when' || (opened && mode === 'always'));

  const TITLES = {
    set: 'oc_kind_set',
    clear: 'oc_kind_clear',
    status: 'oc_kind_status',
    lifecycle: 'oc_kind_lifecycle',
    redact: 'oc_kind_redact',
  } as const;
  const WHEN_LABELS = {
    always: 'oc_when_always',
    when: 'oc_when_when',
    otherwise: 'oc_when_otherwise',
  } as const;

  const propLabel = (k: string, p: Property): string => labelOf(p.label, ctx.locale, k);
  const optionText = (v: unknown): string => (typeof v === 'string' ? v.replace(/^'|'$/g, '') : '');
  const optionLabel = (k: string, l: unknown): string => labelOf(l as never, ctx.locale, k);

  function chooseMode(next: WhenMode): void {
    opened = next === 'when';
    if (next === 'when' && mode !== 'when') {
      if (mode === 'otherwise') write(setStepWhenOps(doc, task, row.index, 'always'));
      return;
    }
    write(setStepWhenOps(doc, task, row.index, next));
  }
</script>

<li class="effect" data-testid={`outcome-${at}`} data-kind={row.kind}>
  <div class="head">
    <span class="title">{t(TITLES[row.kind])}</span>
    <span class="spacer"></span>
    <button
      type="button"
      class="icon-btn"
      aria-label={t('oc_up', { n: at + 1 })}
      disabled={at === 0}
      onclick={() => write(moveOutcomeOps(doc, task, rows, at, -1))}><ChevronUp size={16} /></button
    >
    <button
      type="button"
      class="icon-btn"
      aria-label={t('oc_down', { n: at + 1 })}
      disabled={at === rows.length - 1}
      onclick={() => write(moveOutcomeOps(doc, task, rows, at, 1))}><ChevronDown size={16} /></button
    >
    <button
      type="button"
      class="icon-btn remove"
      aria-label={t('oc_remove', { n: at + 1 })}
      title={t('oc_remove_title')}
      data-testid={`outcome-${at}-remove`}
      onclick={() => write(removeOutcomeOps(doc, task, row.index))}><Trash2 size={16} /></button
    >
  </div>

  {#if step.of !== undefined}
    <!-- A step with `of` acts on other features (a relation's children), not on the task's subject: shown, not edited here. -->
    <p class="hint" data-testid={`${id}-of`}>{t('oc_of', { target: step.of })}</p>
  {/if}

  {#if row.kind === 'lifecycle'}
    <select
      class="select"
      aria-label={t('oc_lifecycle')}
      data-testid={`${id}-lifecycle`}
      value={lifecycle}
      onchange={(e) => write(setLifecycleOps(doc, task, row.index, e.currentTarget.value as LifecycleState))}
    >
      {#each LIFECYCLE_STATES.entries as s (s.key)}
        <option value={s.key}>{labelOf(s.label, ctx.locale, s.key)}</option>
      {/each}
    </select>
  {:else if row.kind === 'redact'}
    <p class="hint">{t('oc_redact_yaml')}</p>
  {:else}
    <select
      class="select"
      aria-label={t('oc_property')}
      data-testid={`${id}-property`}
      value={key}
      onchange={(e) => write(setPropertyOps(doc, task, ctx.type, row.index, e.currentTarget.value))}
    >
      {#if !choices.some(([k]) => k === key)}<option value={key}>{key}</option>{/if}
      {#each choices as [k, p] (k)}<option value={k}>{propLabel(k, p)}</option>{/each}
    </select>
    {#if row.kind === 'status'}
      <select
        class="select"
        aria-label={t('oc_status_value')}
        data-testid={`${id}-status`}
        value={optionText(value)}
        onchange={(e) => write(setValueOps(doc, task, row.index, `'${e.currentTarget.value}'`))}
      >
        {#each options as [k, l] (k)}<option value={k}>{optionLabel(k, l)}</option>{/each}
      </select>
    {:else if row.kind === 'clear'}
      <p class="hint">{t('oc_clear_hint')}</p>
    {:else}
      <ValueInput
        id={`${id}-text`}
        value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
        references={properties.map(([k, p]) => ({ key: k, label: propLabel(k, p) }))}
        {t}
        label={t('oc_value')}
        placeholder={t('oc_value_placeholder')}
        apply={(text) => commit(setValueOps(doc, task, row.index, text), `tasks.${task}.then`)}
      />
    {/if}
  {/if}

  <label class="when-mode">
    <span class="caption">{t('oc_when')}</span>
    <select
      class="select"
      data-testid={`${id}-when`}
      value={showRows ? 'when' : mode}
      onchange={(e) => chooseMode(e.currentTarget.value as WhenMode)}
    >
      {#each WHEN_MODES as m (m)}<option value={m}>{t(WHEN_LABELS[m])}</option>{/each}
    </select>
  </label>
  {#if showRows}
    <ConditionRows
      {id}
      source={step.when}
      {paths}
      {t}
      intro=""
      empty={t('oc_when_empty')}
      apply={(src) => commit(setStepWhenOps(doc, task, row.index, 'when', src), `tasks.${task}.then`)}
    />
  {/if}
</li>

<style>
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
    color: var(--foreground);
  }
  .icon-btn.remove:hover:not(:disabled) {
    color: var(--destructive);
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .select {
    min-width: 0;
    height: 2rem;
    padding: 0 0.5rem;
    font-size: 0.8125rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  .when-mode {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .caption,
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  @media (max-width: 640px) {
    .icon-btn {
      width: 2.75rem;
      height: 2.75rem;
    }
    .select {
      height: 2.75rem;
      font-size: 1rem;
    }
  }
</style>
