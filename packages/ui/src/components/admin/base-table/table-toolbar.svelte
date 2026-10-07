<script lang="ts">
  // v3 data-table-toolbar: search, "clear filters" while a filter is active, the Edit mode switch.
  import XIcon from '@lucide/svelte/icons/x';
  import { Input } from '../../ui/input';
  import { Button } from '../../ui/button';
  import { Switch } from '../../ui/switch';
  import { Label } from '../../ui/label';
  import { m } from '../../../paraglide/messages.js';

  let {
    searchValue,
    onSearchChange,
    onClearFilters,
    hasActiveFilters,
    showEditMode = false,
    editMode = $bindable(false),
    editModeLabel,
  }: {
    searchValue: string;
    onSearchChange: (value: string) => void;
    onClearFilters: () => void;
    hasActiveFilters: boolean;
    showEditMode?: boolean | undefined;
    editMode?: boolean;
    editModeLabel?: string | undefined;
  } = $props();

  const uid = $props.id();
</script>

<div class="flex items-center justify-between gap-3">
  <div class="flex flex-1 items-center gap-3">
    <Input
      type="search"
      placeholder={m.table_search()}
      aria-label={m.table_search()}
      value={searchValue}
      oninput={(e) => onSearchChange(e.currentTarget.value)}
      class="max-w-sm"
    />
    {#if hasActiveFilters}
      <Button variant="ghost" size="sm" onclick={onClearFilters} class="h-8 px-2 lg:px-3">
        {m.table_clear_filters()}
        <XIcon class="ml-2 h-4 w-4" />
      </Button>
    {/if}
  </div>
  {#if showEditMode}
    <div class="flex items-center gap-2">
      <Switch id="{uid}-edit-mode" bind:checked={editMode} />
      <Label for="{uid}-edit-mode" class="cursor-pointer">{editModeLabel ?? m.table_edit_mode()}</Label>
    </div>
  {/if}
</div>
