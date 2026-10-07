<script lang="ts">
  // The Standort cell (v3 `workflows/[workflowId]/+page.svelte:824-845`): a small swatch and the coordinates; hovering
  // (or focusing, so a tap on a phone) shows the shape in a hover card (v3 `GeometryPreview.svelte`). The list rows carry
  // only the anchor, so the geometry is read from the OGC item of this one Objekt, once, when the card first opens.
  // The shape is drawn to scale (`geometry-svg.ts`) on the tiles of the project's own base layer (`tile-underlay.ts`),
  // as in v3; the tile images load only when the card first opens. Without a drawable base the shape stands alone.
  import { LinkPreview } from 'bits-ui';
  import type { PreviewShape } from './geometry-svg';
  import { loadShape } from './geometry-load';
  import ShapeCanvas from './ShapeCanvas.svelte';
  import type { PreviewBasemap, UnderlayTile } from './tile-underlay';

  let {
    project,
    type,
    id,
    label,
    alt,
    failed,
    basemap = null,
  }: {
    project: string;
    type: string;
    id: string;
    label: string;
    alt: string;
    failed: string;
    basemap?: PreviewBasemap | null;
  } = $props();

  const BOX = { width: 240, height: 160, pad: 12 } as const;
  let phase = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  let shape = $state<PreviewShape | null>(null);
  let tiles = $state<readonly UnderlayTile[]>([]);

  async function load(): Promise<void> {
    if (phase !== 'idle') return;
    phase = 'loading';
    const loaded = await loadShape(project, type, id, BOX, basemap);
    shape = loaded?.shape ?? null;
    tiles = loaded?.tiles ?? [];
    phase = loaded === null ? 'failed' : 'ready';
  }
</script>

<LinkPreview.Root openDelay={120} closeDelay={80} onOpenChange={(open) => open && void load()}>
  <LinkPreview.Trigger>
    {#snippet child({ props })}
      <button
        type="button"
        {...props}
        class="flex max-w-full items-center gap-1.5 text-left underline-offset-2 hover:underline"
      >
        <span class="inline-block h-3 w-3 flex-shrink-0 rounded-sm border border-border bg-primary/30"></span>
        <span class="truncate">{label}</span>
      </button>
    {/snippet}
  </LinkPreview.Trigger>
  <LinkPreview.Portal>
    <LinkPreview.Content
      sideOffset={6}
      class="z-50 w-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden"
    >
      <div
        class="relative flex items-center justify-center overflow-hidden rounded border border-border bg-muted/40"
        style="width: {BOX.width}px; height: {BOX.height}px"
      >
        {#if phase === 'ready' && shape}
          <ShapeCanvas {shape} {tiles} width={BOX.width} height={BOX.height} {alt} />
        {:else if phase === 'failed'}
          <span class="px-2 text-center text-xs text-muted-foreground">{failed}</span>
        {:else}
          <span class="text-xs text-muted-foreground" aria-hidden="true">…</span>
        {/if}
      </div>
    </LinkPreview.Content>
  </LinkPreview.Portal>
</LinkPreview.Root>
