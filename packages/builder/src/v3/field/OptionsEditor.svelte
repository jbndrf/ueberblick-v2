<script lang="ts">
  // v3 `FieldConfigPanel.svelte:870-890` "Optionen (eine pro Zeile)" for dropdown and multiple choice. v3 held
  // the options in a textarea; here every option is a row, because a textarea cannot keep an option's key when
  // its label is renamed (A-005: a rename never changes the key, so no value mapping is needed). A row renames
  // in place (v3 `InlineEdit`), moves up and down (v3 `commonMoveUp` / `commonMoveDown`, no drag needed), and
  // removes; a new option is added at the end.
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { Translate } from '../../shell/messages';
  import InlineEdit from '../shared/InlineEdit.svelte';
  import type { OptionRow } from './ops';

  interface Props {
    rows: readonly OptionRow[];
    t: Translate;
    onadd: (label: string) => void;
    onrename: (key: string, label: string) => void;
    onmove: (key: string, delta: -1 | 1) => void;
    onremove: (key: string, label: string) => void;
    /** The explanation text of an option (v3 "Antwort, Erklärungstext"); empty removes it. */
    onhint: (key: string, text: string) => void;
  }
  let { rows, t, onadd, onrename, onmove, onremove, onhint }: Props = $props();

  let draft = $state('');

  function add(): void {
    const text = draft.trim();
    if (text === '') return;
    onadd(text);
    draft = '';
  }
  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }
</script>

<div class="options" data-testid="field-options">
  <span class="options-label" id="field-options-label">{t('field_options_label')}</span>
  {#if rows.length === 0}
    <p class="empty">{t('field_options_empty')}</p>
  {:else}
    <ul aria-labelledby="field-options-label">
      {#each rows as row, i (row.key)}
        <li class="option" data-option={row.key}>
          <InlineEdit
            class="option-name"
            value={row.label}
            oncommit={(text) => onrename(row.key, text)}
            editTitle={t('field_option_edit_title')}
            ariaLabel={t('field_option_rename', { option: row.label })}
          />
          <code class="option-key">{row.key}</code>
          <span class="option-actions">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={i === 0}
              onclick={() => onmove(row.key, -1)}
              aria-label={t('field_option_up', { option: row.label })}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={i === rows.length - 1}
              onclick={() => onmove(row.key, 1)}
              aria-label={t('field_option_down', { option: row.label })}
            >
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground hover:text-destructive"
              onclick={() => onremove(row.key, row.label)}
              aria-label={t('field_option_remove', { option: row.label })}
            >
              <Trash2 />
            </Button>
          </span>
          <Input
            class="option-hint"
            value={row.hint}
            placeholder={t('field_option_hint')}
            aria-label={t('field_option_hint_of', { option: row.label })}
            onchange={(e: Event & { currentTarget: HTMLInputElement }) =>
              onhint(row.key, e.currentTarget.value)}
            data-testid={`option-hint-${row.key}`}
          />
        </li>
      {/each}
    </ul>
  {/if}
  <div class="add">
    <Input
      bind:value={draft}
      {onkeydown}
      placeholder={t('field_option_new')}
      aria-label={t('field_option_add')}
      data-testid="field-option-new"
    />
    <Button
      variant="outline"
      size="icon"
      onclick={add}
      disabled={draft.trim() === ''}
      aria-label={t('field_option_add')}
    >
      <Plus />
    </Button>
  </div>
  <p class="hint">{t('field_options_hint')}</p>
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .options-label {
    font-size: 0.875rem;
    font-weight: 500;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  .option {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.5rem;
    padding: 0 0.25rem 0 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  .option:last-child {
    border-bottom: none;
  }
  .option :global(.option-name) {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    padding: 0.25rem 0.375rem;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: text;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    font-size: 0.8125rem;
  }
  .option :global(button.option-name:hover) {
    border-color: var(--border);
    background: var(--accent);
  }
  .option :global(input.option-name) {
    background: var(--background);
    border-color: var(--input);
  }
  .option-key {
    flex-shrink: 0;
    max-width: 6rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .option-actions {
    display: flex;
    flex-shrink: 0;
  }
  .option :global(.option-hint) {
    flex: 1 0 100%;
    height: 2rem;
    margin: 0 0 0.375rem;
    font-size: 0.75rem;
  }
  .add {
    display: flex;
    gap: 0.375rem;
  }
  .empty,
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .empty {
    font-style: italic;
  }
  @media (max-width: 480px) {
    .option-key {
      display: none;
    }
  }
</style>
