<script lang="ts">
  // The `layers` slot: Kartenlayer (v3 `LayerSheet`). The choice is the layer controller's; the map draws it
  // (`MapCanvas` hands it to the renderer). Closing the sheet closes the slot.
  import { untrack } from 'svelte';
  import type { SheetProps } from '../../shell/sheets';
  import LayerSheet from './LayerSheet.svelte';

  let { ctx, onclose }: SheetProps = $props();

  let open = $state(true);
  $effect(() => {
    if (!open) untrack(onclose);
  });
</script>

<LayerSheet bind:open controller={ctx.layers} locale={ctx.locale} />
