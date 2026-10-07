<script lang="ts">
  // The `cluster` slot of the sheet registry: v3's cluster tap handling (`+page.svelte:1871-1925`, `:2392`). The
  // composition is computed from the device's features (members come from the map's cluster index); a row is the
  // drill-down: the map draws only its members and fits them, a second tap on the active row ends it, and so does
  // closing the sheet (the map flies back to where it was). A tap on empty map closes the sheet (v3 `handleMapClick`);
  // a tap on a feature opens the feature sheet, which replaces this one.
  import { onDestroy, untrack } from 'svelte';
  import type { SheetProps } from '../shell/sheets';
  import ClusterSheet from './ClusterSheet.svelte';
  import { buildClusterGroups, type ClusterGroup, type ClusterRow } from './groups';

  let { ctx, onclose, cluster }: SheetProps = $props();

  const groups = $derived(
    cluster === undefined
      ? []
      : buildClusterGroups(ctx.device.classified, ctx.locale, cluster.members, ctx.device.feature),
  );
  let active: { type: string; key: string } | null = $state(null);

  // A new tap on a cluster starts over: nothing is isolated.
  $effect(() => {
    void cluster;
    untrack(() => {
      if (active !== null) ctx.map?.isolate?.(null);
      active = null;
    });
  });
  $effect(() => ctx.map?.onMapTap(() => onclose()));
  onDestroy(() => ctx.map?.isolate?.(null));

  function row(group: ClusterGroup, r: ClusterRow): void {
    if (active?.type === group.type && active.key === r.key) {
      active = null;
      ctx.map?.isolate?.(null);
      return;
    }
    active = { type: group.type, key: r.key };
    ctx.map?.isolate?.(r.ids);
  }
</script>

{#if cluster !== undefined}
  <ClusterSheet {groups} totalCount={cluster.count} {active} locale={ctx.locale} onrow={row} {onclose} />
{/if}
