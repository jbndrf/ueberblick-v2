<script lang="ts">
  // A stand-in for the region map in jsdom (there is no WebGL): one button that "draws" a fixed box.
  import type { Bounds } from '@ueberblick/core/geo';

  let { open = $bindable(false), onconfirm }: { open?: boolean; onconfirm: (b: Bounds) => void } = $props();
</script>

{#if open}
  <div role="dialog" aria-label="Region">
    <button type="button" onclick={() => onconfirm([7.08, 50.7, 7.14, 50.75])}>Region zeichnen (Test)</button>
  </div>
{/if}
