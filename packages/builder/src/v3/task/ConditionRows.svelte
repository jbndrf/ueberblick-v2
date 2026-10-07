<script lang="ts">
  // v3 `right-sidebar/views/properties/panels/SentryEditor.svelte`: "Nur verfügbar, wenn…" as rows
  // (field, operator, value) joined by AND, "Bedingung hinzufügen" below, an X per row. Every change is
  // written at once, as in v3; the rows are core's chips of the condition (R5), so a condition the rows
  // cannot say stays text. `apply` returns why an edit was not applied; it shows in place.
  import type { Chip } from '@ueberblick/core';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { Translate } from '../../shell/messages';
  import {
    appendChip,
    chipsOfSource,
    chipsToSource,
    removeChip,
    updateChip,
    type CompareChip,
  } from '../../shell/conditions';
  import { startValue, type PathOption } from './paths';
  import {
    isCompare,
    ROW_OP_MESSAGES,
    ROW_OPS,
    rowOpOf,
    rowTakesValue,
    rowValueFor,
    rowValueText,
    withRowOp,
    type RowOp,
  } from './rows';

  interface Props {
    id: string;
    /** The condition without the role clause; undefined: none. */
    source: string | undefined;
    paths: readonly PathOption[];
    t: Translate;
    apply: (source: string) => string | undefined;
    /** The line over the rows ("Nur verfügbar, wenn…" by default; "" hides it). */
    intro?: string | undefined;
    /** What shows when there are no rows ("Immer verfügbar" by default). */
    empty?: string | undefined;
  }
  let { id, source, paths, t, apply, intro, empty }: Props = $props();

  let chips: readonly Chip[] = $state([]);
  let textOnly: string | undefined = $state();
  let draft = $state('');
  let error: string | undefined = $state();
  let seen: string | undefined | null = null;

  // The file is the source of truth: a change that did not come from a row (undo, YAML, another pane) resets the rows.
  $effect(() => {
    if (seen === source) return;
    seen = source;
    error = undefined;
    if (source === undefined) {
      chips = [];
      textOnly = undefined;
      return;
    }
    const r = chipsOfSource(source);
    textOnly = r.ok ? undefined : source;
    chips = r.ok ? r.chips : [];
    draft = source;
  });

  const blank = (): CompareChip => ({
    kind: 'compare',
    left: paths[0]?.value ?? 'actor.id',
    op: '==',
    right: startValue(paths[0]),
  });

  function commit(next: readonly Chip[]): void {
    chips = next;
    error = apply(chipsToSource(next));
  }

  const edit = (i: number, patch: (c: CompareChip) => CompareChip): void => {
    const c = chips[i];
    if (c !== undefined && isCompare(c)) commit(updateChip(chips, i, patch(c)));
  };
  const pathChoices = (left: string): readonly PathOption[] =>
    paths.some((p) => p.value === left) ? paths : [{ value: left, label: left }, ...paths];
</script>

<div class="rows" data-testid="condition-rows">
  {#if intro !== ''}<p class="hint">{intro ?? t('tp_when_intro')}</p>{/if}

  {#if textOnly !== undefined}
    <p class="note">{t('cond_text_only')} {t('tp_when_in_yaml')}</p>
    <textarea id={`${id}-text`} class="code" rows="3" aria-label={t('tp_when_text')} bind:value={draft}
    ></textarea>
    {#if draft !== textOnly}
      <Button size="sm" onclick={() => (error = apply(draft))}>{t('cond_apply')}</Button>
    {/if}
  {:else if chips.length === 0}
    <p class="empty">{empty ?? t('tp_when_empty')}</p>
  {:else}
    <div class="clauses">
      {#each chips as chip, i (i)}
        {#if chip.kind === 'join'}
          <div class="and-divider">
            <select
              class="join"
              aria-label={t('cond_join')}
              value={chip.op}
              onchange={(e) =>
                commit(
                  updateChip(chips, i, { kind: 'join', op: e.currentTarget.value === '||' ? '||' : '&&' }),
                )}
            >
              <option value="&&">{t('tp_and')}</option>
              <option value="||">{t('tp_or')}</option>
            </select>
          </div>
        {:else}
          {@const op = rowOpOf(chip)}
          {@const n = chips.slice(0, i + 1).filter(isCompare).length}
          <div class="clause-row">
            <div class="controls">
              <select
                class="field-select"
                aria-label={t('cond_left', { n })}
                value={chip.left}
                onchange={(e) => edit(i, (c) => ({ ...c, left: e.currentTarget.value }))}
              >
                {#each pathChoices(chip.left) as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
              </select>
              <select
                class="op-select"
                aria-label={t('cond_op', { n })}
                value={op}
                onchange={(e) =>
                  edit(i, (c) =>
                    withRowOp(
                      c,
                      e.currentTarget.value as RowOp,
                      startValue(paths.find((p) => p.value === c.left)),
                    ),
                  )}
              >
                {#each ROW_OPS as o (o)}<option value={o}>{t(ROW_OP_MESSAGES[o])}</option>{/each}
              </select>
              {#if rowTakesValue(op)}
                <Input
                  class="value-input"
                  aria-label={t('cond_right', { n })}
                  placeholder={t('tp_value')}
                  value={rowValueText(chip.right)}
                  onchange={(e) => edit(i, (c) => ({ ...c, right: rowValueFor(op, e.currentTarget.value) }))}
                />
              {/if}
            </div>
            <button
              type="button"
              class="remove"
              aria-label={t('cond_remove', { n })}
              title={t('tp_remove_clause')}
              onclick={() => commit(removeChip(chips, i))}
            >
              <X size={14} />
            </button>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if error !== undefined}<p class="error" role="alert" data-testid="condition-error">{error}</p>{/if}

  {#if textOnly === undefined}
    <div class="add-row">
      <Button variant="outline" size="sm" class="add-btn" onclick={() => commit(appendChip(chips, blank()))}>
        <Plus class="mr-1 h-3.5 w-3.5" />
        {t('tp_when_add')}
      </Button>
    </div>
  {/if}
</div>

<style>
  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .hint,
  .note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .empty {
    margin: 0;
    padding: 0.5rem 0;
    font-size: 0.75rem;
    font-style: italic;
    color: var(--muted-foreground);
  }
  .clauses {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .clause-row {
    display: flex;
    align-items: flex-start;
    gap: 0.375rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: color-mix(in oklab, var(--accent) 20%, transparent);
  }
  .controls {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
  }
  .and-divider {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--muted-foreground);
    text-transform: uppercase;
  }
  .and-divider::before,
  .and-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .join,
  .field-select,
  .op-select {
    min-width: 0;
    flex: 1 1 6rem;
    height: 1.75rem;
    padding: 0 0.375rem;
    font-size: 0.75rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  .join {
    flex: 0 0 auto;
    text-transform: uppercase;
  }
  .controls :global(.value-input) {
    flex: 1 1 6rem;
    height: 1.75rem;
    padding: 0 0.375rem;
    font-size: 0.75rem;
  }
  .remove {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .remove:hover {
    color: var(--destructive);
    background: color-mix(in oklab, var(--destructive) 10%, transparent);
  }
  .code {
    width: 100%;
    padding: 0.5rem;
    font:
      0.75rem/1.4 ui-monospace,
      monospace;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
  .add-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  @media (max-width: 640px) {
    .field-select,
    .op-select,
    .join,
    .controls :global(.value-input) {
      height: 2.5rem;
      font-size: 1rem;
    }
    .remove {
      width: 2.5rem;
      height: 2.5rem;
    }
  }
</style>
