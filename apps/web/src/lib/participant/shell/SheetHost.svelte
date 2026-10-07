<script lang="ts">
  // Mounts the sheets of the open slots through the registry (`sheets.ts`). A slot with no entry shows nothing, so a
  // bar button whose sheet is not ported yet stays and does nothing visible (no placeholder screens).
  import { onDestroy, type Component } from 'svelte';
  import type { FeatureId } from '@ueberblick/core/model';
  import { setUiLocale, type ClusterTap } from '@ueberblick/ui';
  import {
    sheetLoader,
    type SheetLoader,
    type SheetProps,
    type SheetSlot,
    type ShellContext,
  } from './sheets';

  interface Props {
    open: readonly SheetSlot[];
    ctx: ShellContext;
    featureId: FeatureId | null;
    /** The tapped cluster, for the `cluster` slot. */
    cluster?: ClusterTap | null;
    onclose: (slot: SheetSlot) => void;
    /** Where a slot's component comes from; the registry. Tests pass their own. */
    registry?: ((slot: SheetSlot) => SheetLoader | undefined) | undefined;
  }
  let { open, ctx, featureId, cluster = null, onclose, registry = sheetLoader }: Props = $props();

  // The kit's own strings (a dialog's close button) follow the language the person chose, not the compiled base language.
  $effect.pre(() => setUiLocale(ctx.locale));
  onDestroy(() => setUiLocale(undefined));

  const loaded = new Map<SheetSlot, Promise<Component<SheetProps>>>();
  function load(slot: SheetSlot): Promise<Component<SheetProps>> | undefined {
    const known = loaded.get(slot);
    if (known !== undefined) return known;
    const loader = registry(slot);
    if (loader === undefined) return undefined;
    const p = loader().then((m) => m.default);
    loaded.set(slot, p);
    return p;
  }
</script>

{#each open as slot (slot)}
  {@const component = load(slot)}
  {#if component !== undefined}
    {#await component then Sheet}
      <Sheet
        {ctx}
        onclose={() => onclose(slot)}
        {...slot === 'feature' && featureId !== null ? { featureId } : {}}
        {...slot === 'cluster' && cluster !== null ? { cluster } : {}}
      />
    {/await}
  {/if}
{/each}
