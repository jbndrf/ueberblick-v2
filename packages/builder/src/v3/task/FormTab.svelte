<script lang="ts">
  // v3 `TaskConfigSidebar.svelte:377-420`, the Werkzeuge tab (v4: "Formular", because "Werkzeug" is a
  // plug-in): the ordered step list (an icon, the kind, up, down, "Felder bearbeiten"), then the add
  // buttons. v3 removed a step with a right-click menu ("Aus Aufgabe entfernen"); a phone has no right
  // click, so each row has a remove button. "Felder bearbeiten" opens the form editor (WP-380) for the form step. A
  // quick edit picks its properties here (v3 edited them in its own pane), a Standort picks its geometry property.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import FileText from '@lucide/svelte/icons/file-text';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { TaskStep } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import PropertyPicker from './PropertyPicker.svelte';
  import type { BuilderContext } from '../shell/context';
  import { commitOps } from './commit';
  import ConfirmDelete from './ConfirmDelete.svelte';
  import {
    addStepOps,
    moveStepOps,
    removeStepOps,
    replaceStepOps,
    stepCandidates,
    stepList,
    type StepCandidate,
  } from './step-ops';

  interface Props {
    ctx: BuilderContext;
    task: string;
  }
  let { ctx, task }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const steps = $derived(stepList(file, task));
  const scope = $derived(`tasks.${task}`);
  const fields = $derived(Object.keys(file.tasks?.[task]?.form ?? {}));
  const quick = $derived(stepCandidates(file, task, ctx.type, ctx.locale, 'quick_edit'));
  const places = $derived(stepCandidates(file, task, ctx.type, ctx.locale, 'location'));
  const hasForm = $derived(steps.some((s) => s.kind === 'form'));

  const KIND_LABEL = {
    form: () => t('tp_step_form'),
    quick_edit: () => t('tp_step_quick_edit'),
    location: () => t('tp_step_location'),
  } as const;

  let error: string | undefined = $state();
  let picking = $state(false);
  let picked: string[] = $state([]);
  let removing: number | undefined = $state();
  let confirmOpen = $state(false);

  function write(ops: readonly Op[]): boolean {
    error = commitOps(ctx, ops, scope);
    return error === undefined;
  }

  const labelOfKey = (key: string): string => {
    const type = file.tasks?.[task]?.creates ?? ctx.type;
    return labelOf(file.types?.[type]?.properties[key]?.label, ctx.locale, key);
  };

  function startPicking(): void {
    error = undefined;
    picked = [];
    picking = true;
  }

  function addQuickEdit(): void {
    if (picked.length === 0) {
      error = t('tp_qe_min');
      return;
    }
    if (write(addStepOps(doc, task, { kind: 'quick_edit', properties: picked }))) picking = false;
  }

  function addLocation(): void {
    const first = places[0];
    if (first !== undefined) write(addStepOps(doc, task, { kind: 'location', property: first.key }));
  }

  /** The candidates plus what the step already holds, so the picker still lists its own properties. */
  const withOwn = (own: readonly string[], list: readonly StepCandidate[]): StepCandidate[] => [
    ...own.filter((k) => !list.some((c) => c.key === k)).map((k) => ({ key: k, label: labelOfKey(k) })),
    ...list,
  ];

  function changeQuick(index: number, ids: string[]): void {
    if (ids.length === 0) error = t('tp_qe_min');
    else write(replaceStepOps(doc, task, index, { kind: 'quick_edit', properties: ids }));
  }

  function askRemove(index: number): void {
    removing = index;
    if (steps[index]?.kind === 'form' && fields.length > 0) confirmOpen = true;
    else remove();
  }

  function remove(): void {
    confirmOpen = false;
    if (removing !== undefined) write(removeStepOps(doc, task, removing));
    removing = undefined;
  }
</script>

<div class="tab" data-testid="task-tab-form">
  <span class="heading">{t('tp_tab_form')}</span>
  {#if error !== undefined}<p class="error" role="alert" data-testid="steps-error">{error}</p>{/if}

  {#if steps.length === 0}
    <p class="empty" data-testid="steps-empty">{t('tp_steps_empty')}</p>
  {:else}
    <ul class="steps" data-testid="steps">
      {#each steps as step, i (i)}
        {@const n = i + 1}
        <li class="step" data-testid={`step-${i}`} data-kind={step.kind}>
          <div class="row">
            {#if step.kind === 'form'}<FileText size={16} class="icon" />
            {:else if step.kind === 'quick_edit'}<Pencil size={16} class="icon" />
            {:else}<MapPin size={16} class="icon" />{/if}
            <span class="kind">{KIND_LABEL[step.kind]()}</span>
            <button
              type="button"
              class="icon-btn"
              aria-label={t('tp_step_up', { n })}
              disabled={i === 0}
              onclick={() => write(moveStepOps(doc, task, i, -1))}><ChevronUp size={16} /></button
            >
            <button
              type="button"
              class="icon-btn"
              aria-label={t('tp_step_down', { n })}
              disabled={i === steps.length - 1}
              onclick={() => write(moveStepOps(doc, task, i, 1))}><ChevronDown size={16} /></button
            >
            {#if step.kind === 'form'}
              <button
                type="button"
                class="icon-btn"
                aria-label={t('tp_edit_fields')}
                title={t('tp_edit_fields')}
                data-testid={`step-${i}-edit`}
                onclick={() => ctx.select({ kind: 'form', id: task })}><Pencil size={16} /></button
              >
            {/if}
            <button
              type="button"
              class="icon-btn remove"
              aria-label={t('tp_step_remove', { n })}
              data-testid={`step-${i}-remove`}
              onclick={() => askRemove(i)}><Trash2 size={16} /></button
            >
          </div>
          {#if step.kind === 'form'}
            <p class="detail">{t('tp_step_form_fields', { count: fields.length })}</p>
          {:else if step.kind === 'quick_edit'}
            <PropertyPicker
              testid={`step-${i}-properties`}
              label={t('tp_qe_properties')}
              placeholder={t('tp_qe_placeholder')}
              {t}
              selectedIds={step.properties}
              labelsByKey={Object.fromEntries(withOwn(step.properties, quick).map((c) => [c.key, c.label]))}
              onchange={(ids) => changeQuick(i, ids)}
            />
          {:else}
            <label class="detail-select">
              <span class="caption">{t('tp_loc_property')}</span>
              <select
                class="select"
                data-testid={`step-${i}-location`}
                value={step.property}
                onchange={(e) =>
                  write(replaceStepOps(doc, task, i, { kind: 'location', property: e.currentTarget.value }))}
              >
                {#each withOwn([step.property], places) as c (c.key)}<option value={c.key}>{c.label}</option
                  >{/each}
              </select>
            </label>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if picking}
    <div class="picker" data-testid="steps-picker">
      <PropertyPicker
        testid="steps-picker-select"
        label={t('tp_qe_properties')}
        placeholder={t('tp_qe_placeholder')}
        {t}
        selectedIds={picked}
        labelsByKey={Object.fromEntries(quick.map((c) => [c.key, c.label]))}
        onchange={(ids) => (picked = ids)}
      />
      <div class="picker-actions">
        <Button size="sm" data-testid="steps-picker-add" onclick={addQuickEdit}>{t('tp_pick_add')}</Button>
        <Button variant="outline" size="sm" onclick={() => (picking = false)}>{t('tp_cancel')}</Button>
      </div>
    </div>
  {/if}

  <div class="adds">
    <Button
      variant="outline"
      size="sm"
      data-testid="add-form"
      disabled={hasForm}
      title={hasForm ? t('tp_add_form_once') : undefined}
      onclick={() => write(addStepOps(doc, task, { kind: 'form' } satisfies TaskStep))}
    >
      <Plus class="mr-1 h-3 w-3" />{t('tp_step_form')}
    </Button>
    <Button
      variant="outline"
      size="sm"
      data-testid="add-quick-edit"
      disabled={quick.length === 0}
      title={quick.length === 0 ? t('tp_qe_none') : undefined}
      onclick={startPicking}
    >
      <Plus class="mr-1 h-3 w-3" />{t('tp_step_quick_edit')}
    </Button>
    <Button
      variant="outline"
      size="sm"
      data-testid="add-location"
      disabled={places.length === 0}
      title={places.length === 0 ? t('tp_loc_none') : undefined}
      onclick={addLocation}
    >
      <Plus class="mr-1 h-3 w-3" />{t('tp_step_location')}
    </Button>
  </div>
</div>

<ConfirmDelete
  bind:open={confirmOpen}
  {t}
  title={t('tp_step_remove_form_title')}
  impact={fields}
  impactLead={t('tp_step_remove_form_impact')}
  onconfirm={remove}
/>

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
  .steps {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .row :global(.icon) {
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .kind {
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
  .detail,
  .empty,
  .caption {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .empty {
    font-style: italic;
  }
  .detail-select {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .select {
    height: 2.25rem;
    padding: 0 0.5rem;
    font-size: 0.875rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--input);
    border-radius: 0.375rem;
  }
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 1px dashed var(--border);
    border-radius: 0.375rem;
  }
  .picker-actions,
  .adds {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
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
