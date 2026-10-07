<script lang="ts">
  // The Standort pane (v3 `instances/[id]/+page.svelte:277-310`): the location on a map, 16rem high and as wide as
  // the page, with the coordinates below; "Kein Standort festgelegt" without one. v3 drew a Leaflet map; here the shape is
  // drawn to scale on the tiles of the project's own base layer, as the data page's hover card does (`ShapeCanvas`).
  import { loadShape, type LoadedShape } from '../data/geometry-load';
  import ShapeCanvas from '../data/ShapeCanvas.svelte';
  import type { PreviewBasemap } from '../data/tile-underlay';

  let {
    project,
    type,
    id,
    lon,
    lat,
    basemap,
    heading,
    emptyText,
    alt,
    failed,
  }: {
    project: string;
    type: string;
    id: string;
    lon: number | null;
    lat: number | null;
    basemap: PreviewBasemap | null;
    heading: string;
    emptyText: string;
    alt: string;
    failed: string;
  } = $props();

  const HEIGHT = 256;
  const MAX_WIDTH = 896;
  /** Without a layout (a hidden pane) the shape is laid out for this width. */
  const FALLBACK_WIDTH = 640;
  let pane = $state<HTMLElement | undefined>();
  let width = $state(0);
  let loaded = $state<LoadedShape | null>(null);
  let phase = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const located = $derived(lon !== null && lat !== null);

  // Once, when the pane is on the page: the shape and tiles are laid out for its width.
  $effect(() => {
    if (!located || pane === undefined || phase !== 'idle') return;
    const measured = pane.clientWidth || FALLBACK_WIDTH;
    width = measured;
    phase = 'loading';
    void loadShape(
      project,
      type,
      id,
      { width: Math.min(measured, MAX_WIDTH), height: HEIGHT, pad: 24 },
      basemap,
    ).then((result) => {
      loaded = result;
      phase = result === null ? 'failed' : 'ready';
    });
  });
</script>

<div class="space-y-2" data-testid="feature-location">
  <h2 class="text-sm font-semibold text-muted-foreground">{heading}</h2>
  {#if located}
    <div
      class="relative flex h-64 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40"
      bind:this={pane}
    >
      {#if phase === 'ready' && loaded}
        <div class="relative" style="width: {Math.min(width, MAX_WIDTH)}px; height: {HEIGHT}px">
          <ShapeCanvas
            shape={loaded.shape}
            tiles={loaded.tiles}
            width={Math.min(width, MAX_WIDTH)}
            height={HEIGHT}
            {alt}
          />
        </div>
      {:else if phase === 'failed'}
        <span class="px-2 text-center text-xs text-muted-foreground">{failed}</span>
      {:else}
        <span class="text-xs text-muted-foreground" aria-hidden="true">…</span>
      {/if}
    </div>
    <p class="text-xs text-muted-foreground" data-testid="feature-coordinates">
      {(lat as number).toFixed(5)}, {(lon as number).toFixed(5)}
    </p>
  {:else}
    <p class="text-sm text-muted-foreground" data-testid="feature-no-location">{emptyText}</p>
  {/if}
</div>
