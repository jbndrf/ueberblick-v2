<script lang="ts">
  // v3 `components/RoleSelect.svelte`: the canonical "who can see / do this" control of the builder. One wrapper
  // around the kit's MultiSelect, so every per-entity role picker reads the same: a label, the chips selector with
  // inline role creation, and a consistent "empty = everyone" hint. The permission matrix stays the overview
  // for bulk changes; this is the per-entity control, right where the work happens.
  import { MultiSelect, type MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import type { Translate } from '../../shell/messages';
  import { kitLabels } from './kit-labels';

  interface Props {
    selectedIds: readonly string[];
    roles: readonly MultiSelectOption[];
    t: Translate;
    onchange: (ids: string[]) => void;
    /** Context label, e.g. "Sichtbar für Rollen". */
    label?: string | undefined;
    /** Help text. The shared "empty = everyone" hint by default; pass "" to hide. */
    help?: string | undefined;
    placeholder?: string | undefined;
    /** Enables inline role creation when given; returns the new role's key. */
    oncreate?: ((name: string) => string | undefined) | undefined;
    disabled?: boolean;
    testid?: string | undefined;
  }
  let {
    selectedIds,
    roles,
    t,
    onchange,
    label,
    help,
    placeholder,
    oncreate,
    disabled = false,
    testid,
  }: Props = $props();
  const helpText = $derived(help === undefined ? t('role_select_empty_hint') : help);
  const options = $derived<MultiSelectOption[]>(roles.map((r) => ({ ...r })));
  const labels = $derived(
    kitLabels(t, {
      placeholder: placeholder ?? t('role_select_placeholder'),
      dialog: label ?? t('multiselect_dialog'),
      options: label ?? t('multiselect_options'),
    }),
  );

  function create(name: string): MultiSelectOption {
    const value = oncreate?.(name);
    if (value === undefined) throw new Error('role not created');
    return { value, label: name };
  }
</script>

<div class="role-select" data-testid={testid} role="group" aria-label={label}>
  {#if label}<span class="role-select-label">{label}</span>{/if}
  <MultiSelect
    {options}
    selected={[...selectedIds]}
    onSelectedChange={onchange}
    {labels}
    {disabled}
    allowCreate={oncreate !== undefined}
    onCreate={create}
    class="w-full"
  />
  {#if helpText}<p class="role-select-help">{helpText}</p>{/if}
</div>

<style>
  .role-select {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .role-select-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .role-select-help {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
