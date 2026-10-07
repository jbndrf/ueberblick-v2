<script lang="ts">
  // v3 `components/expression-input/ExpressionInput.svelte`: a value or an expression with a picker of the
  // fields to refer to ("Felder hinzufügen…") and an operator panel (math, compare, logic). v3 drew a field
  // as a badge inside its own `{field}` syntax; v4's expression is the rule language's source text
  // (`self.<property>`), which core's checker validates when the row is written (R5), so the picker inserts
  // that text at the cursor. The operator and function groups follow what the language has.
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { Translate } from '../../shell/messages';

  interface Props {
    id: string;
    value: string;
    /** The properties a reference can name (`self.<key>`), with their labels. */
    references: readonly { readonly key: string; readonly label: string }[];
    t: Translate;
    /** Writes the text; returns why it was not written. */
    apply: (text: string) => string | undefined;
    label: string;
    placeholder: string;
  }
  let { id, value, references, t, apply, label, placeholder }: Props = $props();

  const OPERATORS = [
    { group: 'op_group_math', items: ['+', '-', '*', '/', '%', '(', ')'] },
    { group: 'op_group_compare', items: ['>', '<', '==', '!=', '>=', '<='] },
    { group: 'op_group_logic', items: ['&&', '||', '!', '?', ':'] },
  ] as const;

  let input: HTMLInputElement | undefined;
  let error: string | undefined = $state();
  let shown = $state('');
  $effect(() => {
    shown = value;
  });

  function write(text: string): void {
    shown = text;
    if (text === value) return;
    error = apply(text);
  }

  /** Puts `text` at the cursor (or at the end), writes the result and returns the cursor behind it. */
  function insert(text: string): void {
    const el = input;
    const at = el?.selectionStart ?? shown.length;
    const to = el?.selectionEnd ?? at;
    const spaced = /^[a-z]/.test(text) ? text : ` ${text} `;
    const next = `${shown.slice(0, at)}${at === 0 ? text : spaced}${shown.slice(to)}`.replace(/ {2,}/g, ' ');
    write(next);
    queueMicrotask(() => el?.focus());
  }
</script>

<div class="value" data-testid={`${id}-value`}>
  <Input
    onfocus={(e) => (input = e.currentTarget)}
    {id}
    aria-label={label}
    {placeholder}
    value={shown}
    onchange={(e) => write(e.currentTarget.value)}
  />
  <div class="tools">
    <select
      class="select"
      aria-label={t('oc_insert_property')}
      data-testid={`${id}-reference`}
      value=""
      onchange={(e) => {
        if (e.currentTarget.value !== '') insert(`self.${e.currentTarget.value}`);
        e.currentTarget.value = '';
      }}
    >
      <option value="">{t('oc_insert_property')}</option>
      {#each references as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
    </select>
    <select
      class="select"
      aria-label={t('oc_operators')}
      data-testid={`${id}-operators`}
      value=""
      onchange={(e) => {
        if (e.currentTarget.value !== '') insert(e.currentTarget.value);
        e.currentTarget.value = '';
      }}
    >
      <option value="">{t('oc_operators')}</option>
      {#each OPERATORS as g (g.group)}
        <optgroup label={t(g.group)}>
          {#each g.items as o (o)}<option value={o}>{o}</option>{/each}
        </optgroup>
      {/each}
    </select>
  </div>
  {#if error !== undefined}<p class="error" role="alert" data-testid={`${id}-error`}>{error}</p>{/if}
</div>

<style>
  .value {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1 1 10rem;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .select {
    flex: 1 1 6rem;
    min-width: 0;
    height: 1.75rem;
    padding: 0 0.375rem;
    font-size: 0.75rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
  @media (max-width: 640px) {
    .select {
      height: 2.5rem;
      font-size: 1rem;
    }
  }
</style>
