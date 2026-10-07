<script lang="ts">
  // v3 `form-editor/FormEditorView.svelte` as the pane of the selected task's form (v3 `SharedSidebar.svelte:60-75`
  // opened it from the task's Werkzeuge tab in place of the task pane; close goes back to the task). A header (title,
  // close), the left panel (Feldbibliothek and Feldtypen, collapsed to icons or expanded), the form preview in the
  // middle, and "Formular löschen" below. A selected field opens its Felddefinition (WP-337) in place of the palettes
  // and the preview; WP-381 puts v3's field configuration next to it. In v3 the header held an input for the form's
  // name; for a task's form it changed nothing (no handler was passed), so the header shows the task instead.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import { formatKeyPath } from '@ueberblick/core';
  import type { MessageKey } from '../../shell/messages';
  import { labelOf } from '../../shell/location';
  import { setLabelOp } from '../../lenses/data-model/ops';
  import ConfirmDeleteDialog from '../field/ConfirmDeleteDialog.svelte';
  import { deletePropertyOps, usagesOf } from '../field/ops';
  import { getBuilderContext } from '../shell/context';
  import { commitForm } from './commit';
  import { hidesInsteadOfDeletes, provenanceOf } from '../shared/provenance';
  import ConfirmDelete from '../task/ConfirmDelete.svelte';
  import { stagePropertyOf } from '../task/ops';
  import { setFieldAttrOps } from '../../lenses/task/edit';
  import { removeStepOps, stepList } from '../task/step-ops';
  import type { Actions } from './actions';
  import { bindKey, boundOf, splitBindKey } from './bound';
  import { createDrag, type Payload } from './drag.svelte';
  import EditorFoot from './EditorFoot.svelte';
  import EditorHead from './EditorHead.svelte';
  import FieldConfigPanel from './FieldConfigPanel.svelte';
  import FieldPaneHost from './FieldPaneHost.svelte';
  import FormPreview from './FormPreview.svelte';
  import LinkedFieldPanel from './LinkedFieldPanel.svelte';
  import LinkedFieldPicker from './LinkedFieldPicker.svelte';
  import { keysOf, type Dest } from './layout';
  import { editorModel, libraryOf } from './model';
  import { deletePageOps, newFieldOps, pageTextOps, placeOps, removeFromFormOps } from './ops';
  import PalettePanel from './PalettePanel.svelte';
  import { PALETTE_TILES } from './palette';

  const ctx = getBuilderContext();
  const t = $derived(ctx.t);

  const task = $derived(ctx.selection().kind === 'form' ? (ctx.selection().id ?? '') : '');
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const def = $derived(file.tasks?.[task]);
  const model = $derived(editorModel(file, task, ctx.type, ctx.locale));
  const library = $derived(libraryOf(file, task, ctx.type, ctx.locale));
  const stageKey = $derived(stagePropertyOf(file, task, ctx.type));
  const taskName = $derived(labelOf(def?.label, ctx.locale, task));
  const pages = $derived(model.layout.pages);

  let selected: string | undefined = $state();
  // v3 Panel 3: the Felddefinition drilled into from the field's settings; the card's panel is the first level.
  let definition = $state(false);
  let expanded = $state(false);
  let page = $state(0);
  // A page added with "+" has no field yet, so the file cannot hold it: it is the tab at this index until a field joins.
  let pendingAt: number | undefined = $state();
  let error: string | undefined = $state();
  let center: HTMLElement | undefined = $state();
  let removing: string | undefined = $state();
  let removeOpen = $state(false);
  let formDeleteOpen = $state(false);
  let linkedOpen = $state(false);
  const targets = $derived(boundOf(file, task, ctx.type, ctx.locale));

  const pending = $derived(pendingAt !== undefined);
  const shown = $derived(
    pendingAt !== undefined ? Math.min(page, pendingAt) : Math.min(page, Math.max(pages.length - 1, 0)),
  );

  // A new selection (another task) starts at its first page, nothing selected.
  $effect(() => {
    void task;
    page = 0;
    selected = undefined;
    pendingAt = undefined;
    error = undefined;
  });
  $effect(() => {
    if (pendingAt !== undefined && pages.length > pendingAt) pendingAt = undefined;
  });
  $effect(() => {
    if (selected !== undefined && !model.fields.has(selected)) selected = undefined;
  });
  $effect(() => {
    if (selected === undefined) definition = false;
  });

  function write(ops: readonly Parameters<typeof ctx.apply>[0][]): boolean {
    error = commitForm(ctx, ops, `tasks.${task}`);
    return error === undefined;
  }

  const propertyPath = (key: string) => formatKeyPath(['types', model.type, 'properties', key]);

  function add(payload: Payload, dest: Dest): void {
    if (payload.kind === 'tile') {
      const tile = PALETTE_TILES.find((x) => x.key === payload.tile);
      if (tile === undefined) return;
      write(newFieldOps(doc, task, ctx.type, tile, t('form_new_field'), ctx.locale, dest).ops);
    } else {
      write(placeOps(doc, task, ctx.type, payload.key, dest));
    }
  }

  const drag = createDrag({ onDrop: add, scroller: () => center });
  const here = (): Dest => ({ kind: 'page', page: shown });

  const actions: Actions = {
    select: (key) => {
      selected = key;
      definition = false;
    },
    // A field of a linked Objekt is named on its form entry: the property belongs to the other Objektart.
    rename: (key, text) =>
      void write(
        splitBindKey(key) === undefined
          ? [setLabelOp(file, propertyPath(key), ctx.locale, text)]
          : setFieldAttrOps(doc, task, key, 'label', { [ctx.locale]: text }),
      ),
    remove: (key) => void write(removeFromFormOps(doc, task, ctx.type, key)),
    del: (key) => {
      removing = key;
      removeOpen = true;
    },
    pageText: (index, part, text) => {
      if (index < pages.length) write(pageTextOps(doc, task, ctx.type, index, part, ctx.locale, text));
    },
    deletePage: (index) => {
      if (pendingAt === index) {
        pendingAt = undefined;
        page = Math.max(0, pages.length - 1);
      } else if (write(deletePageOps(doc, task, ctx.type, index))) page = Math.max(0, index - 1);
    },
    addPage: () => {
      pendingAt = pages.length;
      page = pages.length;
    },
    openPage: (index) => (page = index),
  };

  function deleteEntirely(): void {
    removeOpen = false;
    const key = removing;
    removing = undefined;
    if (key !== undefined) write(deletePropertyOps(doc, model.type, key));
  }

  const formIndex = $derived(stepList(file, task).findIndex((s) => s.kind === 'form'));
  function deleteForm(): void {
    formDeleteOpen = false;
    if (formIndex >= 0 && write(removeStepOps(doc, task, formIndex))) ctx.select({ kind: 'task', id: task });
  }

  const ghost = $derived.by(() => {
    const p = drag.active;
    if (p === undefined) return '';
    if (p.kind === 'tile') return t(`form_tile_${p.tile}` as MessageKey);
    return model.fields.get(p.key)?.label ?? library.find((e) => e.key === p.key)?.label ?? p.key;
  });
  const removingHides = $derived(
    removing !== undefined && hidesInsteadOfDeletes(provenanceOf(doc, [propertyPath(removing)])),
  );
  const removingName = $derived(
    removing === undefined ? '' : (model.fields.get(removing)?.label ?? removing),
  );
  const removingUsage = $derived(
    removing === undefined ? 0 : usagesOf(file, model.type, removing).tasks.length,
  );
  const fieldLabels = $derived([...model.fields.values()].map((f) => f.label));
</script>

{#if def === undefined}
  <p class="missing" role="status">{t('form_task_missing')}</p>
{:else if formIndex < 0}
  <p class="missing" role="status">{t('form_no_form')}</p>
{:else}
  <div class="editor" data-testid="form-editor" data-task={task} aria-label={t('form_editor')}>
    <EditorHead {t} {taskName} onclose={() => ctx.select({ kind: 'task', id: task })} />
    {#if error !== undefined}<p class="error" role="alert" data-testid="form-error">{error}</p>{/if}

    {#if selected !== undefined}
      <div class="detail" data-testid="form-field-detail">
        {#if definition}
          <button type="button" class="back" data-testid="form-def-back" onclick={() => (definition = false)}>
            <ChevronLeft size={16} />
            {t('form_cfg_back_to_panel')}
          </button>
          <div class="detail-body">
            <FieldPaneHost field={selected} ondeselect={() => (selected = undefined)} />
          </div>
        {:else if splitBindKey(selected) !== undefined}
          <div class="panel-body">
            <LinkedFieldPanel
              {task}
              field={selected}
              {write}
              onback={() => (selected = undefined)}
              onremove={() => actions.remove(selected ?? '')}
            />
          </div>
        {:else}
          <div class="panel-body">
            <FieldConfigPanel
              {task}
              field={selected}
              {write}
              onback={() => (selected = undefined)}
              onremove={() => actions.remove(selected ?? '')}
              ondefinition={() => (definition = true)}
            />
          </div>
        {/if}
      </div>
    {:else}
      <div class="body">
        <PalettePanel
          {t}
          bind:expanded
          {library}
          {drag}
          onaddproperty={(key) => add({ kind: 'property', key }, here())}
          onaddtile={(tile) => add({ kind: 'tile', tile: tile.key }, here())}
          onlinked={() => (linkedOpen = true)}
        />
        <div class="center" bind:this={center} data-testid="form-center">
          <FormPreview
            {t}
            locale={ctx.locale}
            {model}
            page={shown}
            {pending}
            {selected}
            {stageKey}
            {drag}
            {actions}
          />
        </div>
      </div>
    {/if}

    <EditorFoot {t} ondelete={() => (formDeleteOpen = true)} />
  </div>

  {#if drag.active !== undefined}
    <div class="ghost" style:left="{drag.at.x + 12}px" style:top="{drag.at.y + 12}px" aria-hidden="true">
      {ghost}
    </div>
  {/if}

  <LinkedFieldPicker
    bind:open={linkedOpen}
    {t}
    {targets}
    onpick={(name, property) => add({ kind: 'property', key: bindKey(name, property) }, here())}
  />
  <ConfirmDeleteDialog
    bind:open={removeOpen}
    {t}
    hide={removingHides}
    title={t(removingHides ? 'field_hide_title' : 'field_delete_title', { name: removingName })}
    impact={removingUsage > 0 ? [t('field_delete_forms', { count: removingUsage })] : []}
    onconfirm={deleteEntirely}
  />
  <ConfirmDelete
    bind:open={formDeleteOpen}
    {t}
    title={t('tp_step_remove_form_title')}
    impact={fieldLabels}
    impactLead={t('tp_step_remove_form_impact')}
    onconfirm={deleteForm}
  />
{/if}

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    container-type: inline-size;
    background: var(--background);
  }
  .error {
    margin: 0;
    padding: 0.375rem 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
  .body {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  @container (max-width: 499px) {
    .center {
      padding: 0.5rem;
    }
  }
  .center {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    padding: 1rem;
    overflow: auto;
    background: color-mix(in oklab, var(--muted) 60%, var(--background));
  }
  .detail {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
  .back {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.75rem;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    text-align: left;
    background: var(--muted);
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .back:hover {
    color: var(--foreground);
  }
  .panel-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
  .detail-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .missing {
    margin: 1rem;
    font-size: 0.8125rem;
    font-style: italic;
    color: var(--muted-foreground);
  }
  .ghost {
    position: fixed;
    z-index: 9999;
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--primary-foreground);
    white-space: nowrap;
    pointer-events: none;
    background: var(--primary);
    border-radius: 0.375rem;
    box-shadow: 0 4px 12px color-mix(in oklab, var(--primary) 30%, transparent);
  }
</style>
