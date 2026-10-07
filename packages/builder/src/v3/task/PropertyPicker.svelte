<script lang="ts">
  // The quick edit step's property picker: the kit's MultiSelect over a property labels map (v3 picked the
  // quick-edit fields in the form editor; here the step row owns the choice). Not role-specific.
  import { MultiSelect, type MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import type { Translate } from '../../shell/messages';
  import { kitLabels } from '../shared/kit-labels';

  interface Props {
    selectedIds: readonly string[];
    /** Property key to label. */
    labelsByKey: Readonly<Record<string, string>>;
    t: Translate;
    onchange: (ids: string[]) => void;
    label: string;
    placeholder: string;
    testid?: string | undefined;
  }
  let { selectedIds, labelsByKey, t, onchange, label, placeholder, testid }: Props = $props();
  const options = $derived<MultiSelectOption[]>(
    Object.entries(labelsByKey).map(([value, text]) => ({ value, label: text })),
  );
  const labels = $derived(kitLabels(t, { placeholder, dialog: label, options: label }));
</script>

<div class="property-picker" data-testid={testid} role="group" aria-label={label}>
  <span class="caption">{label}</span>
  <MultiSelect {options} selected={[...selectedIds]} onSelectedChange={onchange} {labels} class="w-full" />
</div>

<style>
  .property-picker {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .caption {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
</style>
