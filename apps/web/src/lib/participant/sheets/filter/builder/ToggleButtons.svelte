<script lang="ts">
  // Two exclusive choices that can both be off (a row with neither chosen writes nothing); v3 picked the operator
  // from a list (`ClauseRow.svelte`), here the choices are shown side by side because there are only two.
  import { Button } from '@ueberblick/ui/components/ui/button';

  interface Props {
    options: readonly { readonly value: string; readonly label: string }[];
    selected: string | null;
    onchange: (next: string | null) => void;
  }
  let { options, selected, onchange }: Props = $props();
</script>

<div class="grid grid-cols-2 gap-2">
  {#each options as o (o.value)}
    <Button
      type="button"
      size="sm"
      variant={selected === o.value ? 'default' : 'outline'}
      aria-pressed={selected === o.value}
      onclick={() => onchange(selected === o.value ? null : o.value)}>{o.label}</Button
    >
  {/each}
</div>
