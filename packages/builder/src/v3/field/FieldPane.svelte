<script lang="ts">
  // v3 `inspector/views` and `components/FieldDefinitionEditor`: the Felddefinition
  // of the selected property in the right pane. Label, key, type, required and the options of a select, then
  // the roles that may see and edit the property (right here, where the admin builds the form; the permission
  // matrix is the overview for bulk work), then "Feld vollständig löschen". Every edit is one Doc op.
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { formatKeyPath, processesOf, type Property, type PropertyTypeKey } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { Op } from '../../doc';
  import { commitForm } from '../form/commit';
  import { labelOf } from '../../shell/location';
  import { getBuilderContext } from '../shell/context';
  import FieldBasics from './FieldBasics.svelte';
  import FieldVisibility from './FieldVisibility.svelte';
  import ComputedBlock from './ComputedBlock.svelte';
  import { computedOps } from './computed';
  import { hidesInsteadOfDeletes, provenanceOf } from '../shared/provenance';
  import ConfirmDeleteDialog from './ConfirmDeleteDialog.svelte';
  import TypeSettings from './TypeSettings.svelte';
  import { fileTypesOps, maxFilesOps, numberLimitOps } from './type-ops';
  import OptionsEditor from './OptionsEditor.svelte';
  import {
    addOptionOp,
    changeTypeOp,
    deletePropertyOps,
    moveOptionOp,
    optionRows,
    removeOptionOps,
    setOptionHintOp,
    renameOptionOp,
    usagesOf,
  } from './ops';

  const ctx = getBuilderContext();
  const t = ctx.t;

  const key = $derived(ctx.selection().kind === 'field' ? (ctx.selection().id ?? '') : '');
  const file = $derived(ctx.doc().effective());
  const prop = $derived<Property | undefined>(file.types?.[ctx.type]?.properties[key]);
  const path = $derived(formatKeyPath(['types', ctx.type, 'properties', key]));
  const title = $derived(labelOf(prop?.label, ctx.locale, key));
  const typeKeys = $derived(Object.keys(file.types ?? {}));
  const usage = $derived(usagesOf(file, ctx.type, key));
  const typeDef = $derived(file.types?.[ctx.type]);
  const protectedKey = $derived(typeDef !== undefined && processesOf(typeDef)[0]?.property === key);
  const isSelect = $derived(prop?.type === 'select' || prop?.type === 'multiselect');

  let removedOption = $state('');
  let confirmOpen = $state(false);

  const doc = $derived(ctx.doc());
  // A template field is hidden, not deleted (WP-490): the same rule as the card menu's dialog (R1).
  const hides = $derived(hidesInsteadOfDeletes(provenanceOf(doc, [path])));
  let error: string | undefined = $state();

  /** Ops of the type settings and of Berechnet: tried first (`planEdit`), so a problem shows in place instead of landing in the file. */
  const commit = (ops: readonly Op[]): string | undefined => commitForm(ctx, ops, path);

  function run(op: Parameters<typeof ctx.apply>[0] | undefined): boolean {
    if (op === undefined) return false;
    return ctx.apply(op).refused === undefined;
  }

  function changeType(next: PropertyTypeKey): void {
    removedOption = '';
    run(changeTypeOp(file, ctx.type, key, next, typeKeys));
  }

  const setTarget = (to: string): void => void run({ kind: 'set', path: `${path}.to`, value: to });

  function removeOption(optionKey: string, label: string): void {
    if (removeOptionOps(file, ctx.type, key, optionKey).every((op) => run(op))) removedOption = label;
  }

  function deleteField(): void {
    confirmOpen = false;
    const ops = deletePropertyOps(ctx.doc(), ctx.type, key);
    ctx.select({ kind: 'none' });
    for (const op of ops) if (!run(op)) break;
  }
</script>

{#if prop}
  <section class="property-pane" aria-label={t('field_pane')} data-testid="field-pane" data-path={path}>
    <div class="block">
      <FieldBasics
        {t}
        {prop}
        fieldKey={key}
        {path}
        {title}
        usageCount={usage.tasks.length}
        {file}
        locale={ctx.locale}
        {typeKeys}
        {run}
        onchangetype={changeType}
        onsettarget={setTarget}
      />

      {#if isSelect}
        <OptionsEditor
          rows={optionRows(prop, ctx.locale)}
          {t}
          onadd={(text) => run(addOptionOp(file, ctx.type, key, text, ctx.locale))}
          onrename={(k, text) => run(renameOptionOp(file, ctx.type, key, k, text, ctx.locale))}
          onmove={(k, d) => run(moveOptionOp(file, ctx.type, key, k, d))}
          onremove={removeOption}
          onhint={(k, text) => run(setOptionHintOp(file, ctx.type, key, k, text, ctx.locale))}
        />
        {#if removedOption}<p class="note" role="status" data-testid="option-removed">
            {t('field_option_removed', { option: removedOption })}
          </p>{/if}
      {/if}

      <TypeSettings
        {t}
        {prop}
        onnumber={(part, value) => (error = commit(numberLimitOps(doc, ctx.type, key, part, value)))}
        onfiletypes={(preset) => (error = commit(fileTypesOps(doc, ctx.type, key, preset)))}
        onmaxfiles={(count) => (error = commit(maxFilesOps(doc, ctx.type, key, count)))}
        ondatemode={(mode) => run(changeTypeOp(file, ctx.type, key, mode, typeKeys))}
      />
      {#if error !== undefined}<p class="note error" role="alert" data-testid="field-error">{error}</p>{/if}

      <ComputedBlock
        {t}
        locale={ctx.locale}
        {file}
        type={ctx.type}
        source={prop.computed}
        inForm={usage.tasks.length > 0}
        apply={(source) => commit(computedOps(doc, ctx.type, key, source))}
      />
    </div>

    <div class="block visibility">
      <FieldVisibility {t} {file} type={ctx.type} fieldKey={key} locale={ctx.locale} {run} />
    </div>

    <div class="block danger">
      {#if protectedKey}
        <p class="hint">{t('field_delete_protected')}</p>
      {:else}
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-destructive"
          onclick={() => (confirmOpen = true)}
        >
          <Trash2 />
          {hides ? t('prov_hide') : t('field_delete')}
        </Button>
      {/if}
    </div>
  </section>

  <ConfirmDeleteDialog
    bind:open={confirmOpen}
    hide={hides}
    title={t(hides ? 'field_hide_title' : 'field_delete_title', {
      name: title || t('field_delete_untitled'),
    })}
    impact={usage.tasks.length > 0 ? [t('field_delete_forms', { count: usage.tasks.length })] : []}
    {t}
    onconfirm={deleteField}
  />
{/if}

<style>
  .property-pane {
    display: flex;
    flex-direction: column;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
  }
  .block + .block {
    border-top: 1px solid var(--border);
  }
  .note {
    margin: 0;
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--muted);
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .note.error {
    font-weight: 600;
    color: var(--destructive);
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
