<script lang="ts">
  // Text, number and date cells (v3 text-field, number-field, date-field): click to edit in Edit mode, Enter saves, Esc cancels.
  import CopyIcon from '@lucide/svelte/icons/copy';
  import CheckIcon from '@lucide/svelte/icons/check';
  import { toast } from 'svelte-sonner';
  import { Input } from '../../../ui/input';
  import { Textarea } from '../../../ui/textarea';
  import { Button } from '../../../ui/button';
  import { m } from '../../../../paraglide/messages.js';
  import { getLocale } from '../../../../paraglide/runtime.js';
  import { commitCell } from './commit';
  import { displayValue, inputType, toEditingValue } from './format';
  import type { CellProps } from '../types';

  let props: CellProps = $props();
  const { value, column, editable, row } = $derived(props);

  let isEditing = $state(false);
  let editingValue = $state('');
  let isSaving = $state(false);
  let copied = $state(false);

  const text = $derived(displayValue(value, column, getLocale()));
  const type = $derived(inputType(column));
  const multiline = $derived(column.multiline === true && (column.kind ?? 'text') === 'text');

  function startEditing() {
    editingValue = toEditingValue(value, column);
    isEditing = true;
  }

  async function save() {
    if (isSaving) return;
    isSaving = true;
    const saved = await commitCell(props, editingValue);
    isSaving = false;
    if (saved) isEditing = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !multiline) {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      isEditing = false;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(column.copyValue && row ? column.copyValue(row) : String(value));
      copied = true;
      toast.success(m.table_copied());
      setTimeout(() => (copied = false), 2000);
    } catch {
      toast.error(m.table_copy_failed());
    }
  }

  // Focus the field when it opens.
  function focus(node: HTMLElement) {
    node.focus();
  }
</script>

{#if isEditing && multiline}
  <Textarea
    bind:value={editingValue}
    {onkeydown}
    onblur={save}
    class="min-h-[80px] px-2 py-1"
    aria-label={column.label}
    disabled={isSaving}
    {@attach focus}
  />
{:else if isEditing}
  <Input
    {type}
    bind:value={editingValue}
    {onkeydown}
    onblur={save}
    class="h-8 px-2 py-1"
    aria-label={column.label}
    disabled={isSaving}
    {@attach focus}
  />
{:else}
  <div class="flex items-center gap-2">
    {#if editable}
      <button
        type="button"
        onclick={startEditing}
        class="-mx-2 -my-1 block max-w-[300px] flex-1 cursor-text truncate rounded px-2 py-1 text-left transition-colors hover:bg-muted/50"
        title={text}>{text}</button
      >
    {:else}
      <span
        class="-mx-2 -my-1 block max-w-[300px] flex-1 cursor-default truncate rounded px-2 py-1 text-left select-text"
        title={text}>{text}</span
      >
    {/if}
    {#if column.copyable && value}
      <Button variant="ghost" size="sm" onclick={copy} class="relative z-10 h-7 w-7 flex-shrink-0 p-0">
        {#if copied}<CheckIcon class="h-3 w-3 text-green-600" />{:else}<CopyIcon class="h-3 w-3" />{/if}
        <span class="sr-only">{m.table_copy()}</span>
      </Button>
    {/if}
  </div>
{/if}
