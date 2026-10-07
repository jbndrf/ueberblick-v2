<script lang="ts">
  // v3 array-field: badges for the picked entries; where the cell is editable a click opens v3's MultiSelect inline with
  // Save and Cancel. The change stays pending until Save (one write, one toast); Cancel throws it away.
  import { Badge } from '../../../ui/badge';
  import { Button } from '../../../ui/button';
  import { MultiSelect } from '../../../ui/multi-select';
  import { m } from '../../../../paraglide/messages.js';
  import { commitCell } from './commit';
  import type { CellProps, ChoiceOption } from '../types';

  let props: CellProps = $props();
  const { value, column, editable } = $derived(props);
  const picked = $derived(Array.isArray(value) ? value.map(String) : value ? [String(value)] : []);
  const label = (id: string) => column.options?.find((o) => o.value === id)?.label ?? id;

  let isEditing = $state(false);
  let pending = $state<string[]>([]);
  let isSaving = $state(false);
  // Entries made by typing a name; kept so the badge can show it before the parent has the new option.
  let created = $state<ChoiceOption[]>([]);
  const options = $derived<ChoiceOption[]>([...(column.options ?? []), ...created]);

  function start() {
    if (!editable) return;
    pending = [...picked];
    isEditing = true;
  }
  function cancel() {
    isEditing = false;
    pending = [];
    created = [];
  }
  async function save() {
    if (isSaving) return;
    isSaving = true;
    const saved = await commitCell(props, pending);
    isSaving = false;
    if (saved) {
      isEditing = false;
      created = [];
    }
  }
  async function createEntity(name: string): Promise<ChoiceOption> {
    if (!column.onCreateEntity) throw new Error('column has no onCreateEntity');
    const made = await column.onCreateEntity(name);
    created = [...created, made];
    return made;
  }
</script>

{#if isEditing}
  <div class="flex w-full flex-col gap-2">
    <MultiSelect
      bind:selected={pending}
      {options}
      singleSelect={column.singleSelect ?? false}
      allowCreate={column.onCreateEntity !== undefined}
      onCreate={column.onCreateEntity ? createEntity : undefined}
      labels={{ placeholder: m.table_array_placeholder() }}
    />
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="sm" onclick={save} disabled={isSaving} class="h-7 px-2 text-xs">
        {m.table_save()}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onclick={cancel}
        disabled={isSaving}
        class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        {m.table_cancel()}
      </Button>
    </div>
  </div>
{:else}
  <div class="flex w-full items-center gap-2">
    <button
      type="button"
      onclick={start}
      disabled={!editable}
      class="-mx-2 -my-1 flex-1 rounded px-2 py-1 text-left transition-colors {editable
        ? 'cursor-pointer hover:bg-muted/50'
        : 'cursor-default'}"
    >
      {#if picked.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each picked as id (id)}<Badge variant="secondary" class="text-xs">{label(id)}</Badge>{/each}
        </div>
      {:else}
        <span class="text-sm text-muted-foreground">{column.emptyText ?? m.table_array_empty()}</span>
      {/if}
    </button>
  </div>
{/if}
