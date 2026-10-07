<script lang="ts">
  // v3 `StageInspector.svelte` + `ParticipantPreview.svelte`: the right pane for a selected stage, and
  // for no selection (v3's "Standardansicht"). A header in the participant's primary colour (stage name
  // edited in place, type Start / Zwischenschritt / Ende, role of the preview, delete, close), the
  // action roll bar with the stage's buttons, then the Daten view. Everything shown is computed from
  // the file by `preview.ts` (simulator and permissions), and every edit is a Doc op.
  import { processesOf } from '@ueberblick/core';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import { canReset, hidesInsteadOfDeletes, provenanceOf, resetOps } from '../shared/provenance';
  import { ELEMENT_KINDS, elementPaths } from '../shared/provenance-elements';
  import { getBuilderContext } from '../shell/context';
  import ConfirmDelete from '../task/ConfirmDelete.svelte';
  import ActionBar from './ActionBar.svelte';
  import DataSection from './DataSection.svelte';
  import StageHeader from './StageHeader.svelte';
  import {
    stageDeleteImpact,
    stageLock,
    stageOps,
    stageTypeOf,
    STAGE_TYPES,
    TYPE_REFUSALS,
    type StageType,
  } from './ops';
  import { refusalText } from '../shell/refusal';
  import { ALL_ROLES, previewRoles, stagePreview } from './preview';

  const ctx = getBuilderContext();
  const t = ctx.t;
  const locale = ctx.locale;

  let role = $state(ALL_ROLES);
  let confirming = $state(false);
  let notice = $state('');
  let selectedButton: string | null = $state(null);

  const file = $derived(ctx.doc().effective());
  const featureType = $derived(file.types?.[ctx.type]);
  const process = $derived(featureType === undefined ? undefined : processesOf(featureType)[0]);
  const selection = $derived(ctx.selection());
  const options = $derived(featureType?.properties[process?.property ?? '']?.options ?? {});
  const stage = $derived(
    selection.kind === 'stage' && selection.id !== undefined && selection.id in options ? selection.id : null,
  );
  const name = $derived(stage === null ? '' : labelOf(options[stage], locale, stage));
  const stageType = $derived<StageType>(
    stage === null ? STAGE_TYPES.intermediate : stageTypeOf(file, ctx.type, stage),
  );
  const roles = $derived(previewRoles(file, locale));
  const preview = $derived(stagePreview(file, ctx.type, stage, role, locale));
  /** The template locks this stage: a probe rename is refused, so the name and delete are disabled. */
  const lock = $derived(stage === null ? undefined : stageLock(ctx.doc(), ctx.type, stage, locale));
  // Where the stage comes from (WP-480, the same paths as the canvas node): the mark, the reset, and for a template stage a hide.
  const paths = $derived(
    stage === null ? [] : elementPaths(ctx.doc(), ctx.type, { kind: ELEMENT_KINDS.stage, key: stage }),
  );
  const info = $derived(stage === null ? undefined : provenanceOf(ctx.doc(), paths));
  const hide = $derived(hidesInsteadOfDeletes(info));
  // The kit's confirm (v3 ConfirmDeleteDialog, as the canvas delete): the impact is read when it opens.
  const impact = $derived(
    confirming && stage !== null ? stageDeleteImpact(ctx.doc(), ctx.type, stage, locale) : undefined,
  );
  const confirmTitle = $derived(hide ? t('stage_hide_title', { name }) : t('stage_delete_confirm', { name }));

  // A new selection starts clean: the confirm closes, the selected button is forgotten.
  $effect(() => {
    void selection;
    confirming = false;
    notice = '';
    selectedButton = null;
  });

  /** The Daten tab edits: the ops of the Felder hub, applied one by one; a refusal is shown as the notice. */
  function runOps(ops: readonly Op[]): boolean {
    notice = '';
    for (const op of ops) {
      const r = ctx.apply(op);
      if (r.refused !== undefined) {
        notice = refusalText(t, ctx.doc(), [op], r.refused, locale);
        return false;
      }
    }
    return true;
  }

  function rename(text: string): void {
    if (stage === null) return;
    const op = stageOps.rename(file, ctx.type, stage, locale, text);
    if (op === undefined) return;
    const r = ctx.apply(op);
    notice = r.refused === undefined ? '' : refusalText(t, ctx.doc(), [op], r.refused, locale);
  }

  function changeType(event: Event & { currentTarget: HTMLSelectElement }): void {
    if (stage === null) return;
    const r = stageOps.setType(file, ctx.type, stage, event.currentTarget.value as StageType);
    event.currentTarget.value = stageType;
    if (!r.ok) {
      notice = r.reason === TYPE_REFUSALS.startNeeded ? t('stage_start_needed') : t('stage_end_needed');
      return;
    }
    notice = '';
    if (r.op !== undefined) {
      const applied = ctx.apply(r.op);
      if (applied.refused !== undefined) notice = refusalText(t, ctx.doc(), [r.op], applied.refused, locale);
    }
  }

  function reset(): void {
    runOps(resetOps(ctx.doc(), paths));
  }

  function addButton(): void {
    if (stage === null) return;
    const r = stageOps.addButton(file, ctx.type, stage, locale, t('catalog_new_task'));
    if (r.ok && ctx.apply(r.op).refused === undefined) ctx.select({ kind: 'task', id: r.key });
  }

  function confirmDelete(): void {
    if (impact === undefined) return;
    const r = ctx.apply(impact.op);
    confirming = false;
    if (r.refused !== undefined) {
      notice = refusalText(t, ctx.doc(), [impact.op], r.refused, locale);
      return;
    }
    ctx.select({ kind: 'none' });
  }
</script>

<div
  class="pane"
  data-testid="stage-pane"
  data-stage={stage ?? ''}
  aria-label={t('stage_preview')}
  role="region"
>
  <StageHeader
    {t}
    {stage}
    {name}
    {stageType}
    {role}
    {roles}
    {lock}
    {info}
    {hide}
    canReset={canReset(info)}
    onreset={reset}
    onrename={rename}
    ontype={changeType}
    onrole={(r) => (role = r)}
    ondelete={() => (confirming = true)}
    onclose={() => ctx.select({ kind: 'none' })}
  />

  {#if notice !== ''}<p class="notice" role="alert" data-testid="stage-notice">{notice}</p>{/if}

  {#if impact !== undefined}
    <ConfirmDelete
      bind:open={confirming}
      {t}
      title={confirmTitle}
      impact={impact.problems.map((p) => p.message)}
      impactLead={t('stage_delete_impact')}
      {hide}
      hideBody={t('stage_hide_body')}
      onconfirm={confirmDelete}
    />
  {/if}

  <div class="body">
    <div class="inner">
      {#if stage !== null}
        <ActionBar
          buttons={preview.buttons}
          {t}
          selected={selectedButton}
          onselect={(key) => {
            selectedButton = key;
            ctx.select({ kind: 'task', id: key });
          }}
          onadd={addButton}
        />
      {/if}
      <DataSection
        properties={preview.properties}
        {t}
        byRole={role !== ALL_ROLES}
        onselect={(key) => ctx.select({ kind: 'field', id: key })}
        run={runOps}
        onnotice={(message) => (notice = message)}
      />
    </div>
  </div>
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background: var(--background);
    border-radius: 0.75rem 0.75rem 0 0;
  }
  .notice {
    margin: 0;
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
    color: var(--destructive);
    background: var(--muted);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .inner {
    padding: 1rem;
  }
</style>
