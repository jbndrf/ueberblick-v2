<script lang="ts">
  // "Verknüpfte Objekte" (A-053): the task's `bind`, name -> a one-relation of the subject type. v3 had no
  // binds (it used the parent implicitly, `FormEditorView.svelte:486-499`); the A5 linked form fields need them.
  // Rows: name, relation (with the target type), remove; below, "Verknüpftes Objekt hinzufügen" picks a relation.
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { Op } from '../../doc';
  import type { BuilderContext } from '../shell/context';
  import {
    addBindOps,
    bindCandidates,
    bindRows,
    freeBindName,
    removeBindOps,
    renameBindOps,
    setBindOps,
  } from './bind-ops';
  import { bindImpactOf, type BindImpact } from './bind-impact';
  import BindImpactDialog from './BindImpactDialog.svelte';
  import { commitOps } from './commit';

  interface Props {
    ctx: BuilderContext;
    task: string;
  }
  let { ctx, task }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const rows = $derived(bindRows(file, task, ctx.type, ctx.locale));
  const candidates = $derived(bindCandidates(file, task, ctx.type, ctx.locale));
  let error: string | undefined = $state();

  let impactOpen = $state(false);
  let impactName = $state('');
  let impactAction: 'remove' | 'rename' = $state('remove');
  let impact: BindImpact = $state({ fields: [], expressions: [] });

  /** `undefined` ops: refused because form entries use the bind; the dialog lists what depends on it (v3 `deletion.ts`). */
  function write(ops: readonly Op[] | undefined, name: string, action: 'remove' | 'rename' = 'remove'): void {
    if (ops === undefined) {
      error = undefined;
      impactName = name;
      impactAction = action;
      impact = bindImpactOf(doc, task, name, ctx.locale);
      impactOpen = true;
      return;
    }
    error = commitOps(ctx, ops, `tasks.${task}`);
  }

  /** The typed name becomes a key (and a free one); empty text restores the old name. */
  function rename(name: string, input: HTMLInputElement): void {
    if (input.value.trim() === '') {
      input.value = name;
      return;
    }
    const next = freeBindName(file, task, input.value, name);
    const ops = renameBindOps(doc, task, name, next);
    write(ops, name, 'rename');
    // A refused rename (form entries use the bind) leaves the bind as it was: the input shows its name again.
    input.value = ops === undefined ? name : next;
  }

  function add(relation: string): void {
    const c = candidates.find((x) => x.relation === relation);
    if (c === undefined) return;
    write(addBindOps(doc, task, freeBindName(file, task, c.relation), c.expr), c.relation);
  }
</script>

<section class="binds" data-testid="task-binds">
  <h3 class="title">{t('tp_binds')}</h3>
  <p class="hint">{t('tp_binds_hint')}</p>

  {#each rows as row (row.name)}
    <div class="row" data-testid="task-bind-row" data-bind={row.name}>
      <label class="cell">
        <span class="caption">{t('tp_bind_name')}</span>
        <Input
          data-testid="task-bind-name"
          value={row.name}
          onchange={(e) => rename(row.name, e.currentTarget)}
        />
      </label>
      <label class="cell">
        <span class="caption">{t('tp_bind_relation')}</span>
        {#if row.candidate === undefined}
          <span class="expr" data-testid="task-bind-expr" title={t('tp_bind_custom')}>{row.expr}</span>
        {:else}
          <select
            class="select"
            data-testid="task-bind-relation"
            value={row.candidate.relation}
            onchange={(e) =>
              write(setBindOps(doc, task, row.name, `self.${e.currentTarget.value}`), row.name)}
          >
            {#each candidates as c (c.relation)}
              <option value={c.relation}>{c.label} → {c.targetLabel}</option>
            {/each}
          </select>
        {/if}
      </label>
      <button
        type="button"
        class="remove"
        data-testid="task-bind-remove"
        aria-label={t('tp_bind_remove', { name: row.name })}
        onclick={() => write(removeBindOps(doc, task, row.name), row.name)}>×</button
      >
    </div>
  {/each}

  {#if candidates.length === 0}
    <p class="hint" data-testid="task-bind-none">{t('tp_bind_none')}</p>
  {:else}
    <select
      class="select add"
      data-testid="task-bind-add"
      value=""
      aria-label={t('tp_bind_add')}
      onchange={(e) => {
        add(e.currentTarget.value);
        e.currentTarget.value = '';
      }}
    >
      <option value="">+ {t('tp_bind_add')}</option>
      {#each candidates as c (c.relation)}
        <option value={c.relation}>{c.label} → {c.targetLabel}</option>
      {/each}
    </select>
  {/if}
  {#if error !== undefined}<p class="error" role="alert" data-testid="task-bind-error">{error}</p>{/if}
  <BindImpactDialog bind:open={impactOpen} {t} name={impactName} action={impactAction} {impact} />
</section>

<style>
  .binds {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid color-mix(in oklab, var(--border) 40%, transparent);
  }
  .title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }
  .caption {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .select {
    width: 100%;
    height: 2.25rem;
    padding: 0 0.5rem;
    font-size: 0.875rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--input);
    border-radius: 0.375rem;
  }
  .select:focus-visible,
  .remove:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  .expr {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 2.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .remove {
    flex-shrink: 0;
    width: 2.25rem;
    height: 2.25rem;
    font-size: 1.125rem;
    color: var(--muted-foreground);
    background: transparent;
    border: 1px solid var(--input);
    border-radius: 0.375rem;
    cursor: pointer;
  }
  .remove:hover {
    color: var(--destructive);
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
  @media (max-width: 640px) {
    .row {
      flex-wrap: wrap;
    }
    .select,
    .remove {
      height: 2.75rem;
      font-size: 1rem;
    }
    .remove {
      width: 2.75rem;
    }
  }
</style>
