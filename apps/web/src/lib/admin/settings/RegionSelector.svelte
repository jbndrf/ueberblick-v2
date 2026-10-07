<script lang="ts">
  // v3 `components/map/region-selector.svelte`: a full dialog (80vh, max-w-4xl) with a map to mark the pack's region.
  // Header: title, a line that says what to do, the area and the tile estimate once a region exists, the mode buttons
  // Rechteck / Polygon and "Löschen". Footer: Abbrechen, Bestätigen (enabled with a region). The map is the project's own
  // base layer on the MapLibre renderer the participant app uses. Done better, because a drag pans the map and a double
  // tap zooms it on a phone: the rectangle is two taps on opposite corners, the polygon is closed with "Fertig"
  // (`region-draw.ts`). A pack is a box, so a polygon is saved as the box around it, and that box is what is drawn.
  import { onDestroy, untrack } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import Pentagon from '@lucide/svelte/icons/pentagon';
  import Square from '@lucide/svelte/icons/square';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import { RENDERERS, defaultSelection } from '@ueberblick/core/registry';
  import type { Bounds, Position } from '@ueberblick/core/geo';
  import type { View } from '@ueberblick/core/model';
  import { createRendererMap, getRenderer, THEMES, type MapHandle } from '@ueberblick/ui';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { withDefaultBase } from '../../participant/sheets/layer/layer-controller';
  import { boundsAreaKm2, formatArea, formatTileCount } from './packs';
  import {
    boxRing,
    canFinish,
    clearDraft,
    drawn,
    finishPolygon,
    setMode,
    startDraft,
    tap,
    type DrawMode,
    type LngLat,
    type RegionDraft,
  } from './region-draw';
  import type { SettingsDocData } from './types';

  let {
    open = $bindable(false),
    locale,
    mapConfig,
    start,
    initial,
    estimateTiles,
    onconfirm,
  }: {
    open?: boolean;
    locale: Locale;
    mapConfig: SettingsDocData['mapConfig'];
    /** Where the map opens (the Standardansicht, v3 `mapDefaults`). */
    start: { readonly lat: number; readonly lng: number; readonly zoom: number };
    /** The region already chosen, drawn when the dialog opens. */
    initial: Bounds | null;
    /** The tile count of a box at the pack's zoom range. */
    estimateTiles: (bounds: Bounds) => number;
    onconfirm: (bounds: Bounds) => void;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  // MapLibre's worker is copied into the build by `vite.config.ts`, as for the participant map.
  const WORKER_URL = `/_app/immutable/maplibre-gl-${__MAPLIBRE_VERSION__}/maplibre-gl-worker.mjs`;
  const COLOR = THEMES.normal.color.primary;

  let box = $state<HTMLElement | null>(null);
  let handle: MapHandle | undefined;
  let stops: (() => void)[] = [];
  let draft = $state<RegionDraft>(startDraft());
  let hover: LngLat | null = null;
  let failed = $state(false);
  /** The map is drawn and takes taps (the e2e waits for it). */
  let ready = $state(false);
  let mounted = false;

  const region = $derived(draft.region);
  const stats = $derived(
    region === null ? null : { area: boundsAreaKm2(region), tiles: estimateTiles(region) },
  );

  function render(): void {
    if (handle === undefined) return;
    const d = drawn(draft, hover);
    handle.clearOverlay('region');
    if (d === null) return;
    const style = {
      color: COLOR,
      fillColor: COLOR,
      width: 2,
      dashed: !(d.kind === 'box' && d.final),
      opacity: 0.9,
    };
    handle.showOverlay(
      'region',
      d.kind === 'box'
        ? { type: 'Polygon', coordinates: [boxRing(d.bounds)] }
        : { type: 'LineString', coordinates: d.points.map((p) => [...p]) },
      style,
    );
  }

  /** The region is drawn on the ground: a position's height is dropped. */
  const flat = (at: Position): LngLat => [at[0], at[1]];

  const update = (next: RegionDraft): void => {
    draft = next;
    render();
  };

  async function mountMap(node: HTMLElement): Promise<void> {
    const ml = await import('maplibre-gl');
    ml.setWorkerUrl(WORKER_URL);
    if (!mounted) return;
    const renderer = getRenderer(createRendererMap(), RENDERERS.keys[0]);
    const h = renderer.mount(node, { renderer: 'maplibre-2d' } as unknown as View, {
      query: () => [],
      queryChunks: function* () {},
      subscribe: () => () => undefined,
    });
    handle = h;
    h.ready.catch(() => (failed = true));
    await h.ready;
    if (!mounted) return;
    const drawnMap = withDefaultBase(
      mapConfig ?? undefined,
      mapConfig === null ? { base: undefined, overlays: [] } : defaultSelection(mapConfig),
    );
    h.setBasemaps?.(drawnMap.map, drawnMap.selection);
    if (initial === null) h.centerOn([start.lng, start.lat], { zoom: start.zoom });
    else h.centerOn(initial);
    stops.push(h.onMapTap((at) => update(tap(draft, flat(at)))));
    ready = true;
    const move = (e: PointerEvent): void => {
      const r = node.getBoundingClientRect();
      const at = h.unproject({ x: e.clientX - r.left, y: e.clientY - r.top });
      hover = at === undefined ? null : flat(at);
      if (draft.corner !== null || draft.vertices.length > 0) render();
    };
    node.addEventListener('pointermove', move);
    stops.push(() => node.removeEventListener('pointermove', move));
    render();
  }

  function teardown(): void {
    mounted = false;
    stops.forEach((s) => s());
    stops = [];
    handle?.destroy();
    handle = undefined;
    hover = null;
  }

  // The map lives while the dialog is open; every opening starts from the region given.
  $effect(() => {
    const node = box;
    if (!open || node === null) return;
    untrack(() => {
      draft = startDraft(initial);
      failed = false;
      ready = false;
      mounted = true;
      void mountMap(node);
    });
    return teardown;
  });
  onDestroy(teardown);

  const hint = $derived(
    region !== null
      ? t('region_hint_done')
      : draft.mode === 'rectangle'
        ? t(draft.corner === null ? 'region_hint_rect' : 'region_hint_rect_second')
        : t('region_hint_polygon'),
  );
  const modes: { mode: DrawMode; label: AdminKey; icon: typeof Square }[] = [
    { mode: 'rectangle', label: 'region_rectangle', icon: Square },
    { mode: 'polygon', label: 'region_polygon', icon: Pentagon },
  ];
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[80vh] max-w-4xl flex-col gap-0 p-0 sm:max-w-4xl" data-testid="region-dialog">
    <Dialog.Header class="shrink-0 border-b px-4 pt-6 pb-4 sm:px-6">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <Dialog.Title>{t('region_title')}</Dialog.Title>
          <Dialog.Description data-testid="region-hint">{hint}</Dialog.Description>
        </div>
        {#if stats}
          <div class="shrink-0 text-right text-sm" data-testid="region-stats">
            <div class="font-medium">{formatArea(stats.area)}</div>
            <div class="text-muted-foreground">{formatTileCount(stats.tiles)} {t('region_tiles')}</div>
          </div>
        {/if}
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        {#each modes as m (m.mode)}
          {@const Icon = m.icon}
          <Button
            variant={draft.mode === m.mode ? 'default' : 'outline'}
            size="sm"
            disabled={region !== null}
            aria-pressed={draft.mode === m.mode}
            onclick={() => update(setMode(draft, m.mode))}
          >
            <Icon class="mr-1 h-4 w-4" />
            {t(m.label)}
          </Button>
        {/each}
        {#if canFinish(draft)}
          <Button size="sm" onclick={() => update(finishPolygon(draft))}>
            <Check class="mr-1 h-4 w-4" />
            {t('region_finish')}
          </Button>
        {/if}
        {#if region !== null}
          <Button variant="outline" size="sm" class="ml-auto" onclick={() => update(clearDraft(draft))}>
            <Trash2 class="mr-1 h-4 w-4" />
            {t('region_clear')}
          </Button>
        {/if}
      </div>
    </Dialog.Header>

    <div
      class="relative min-h-0 flex-1"
      role="region"
      aria-label={t('region_map')}
      data-testid="region-map"
      data-ready={ready}
      data-region={region === null ? '' : region.join(',')}
    >
      <!-- MapLibre gives its container `position: relative`, so the sized, positioned box is this parent and the map
           fills it with h-full; touch-none: a drag pans the map and never scrolls the dialog -->
      <div bind:this={box} class="h-full w-full cursor-crosshair touch-none"></div>
      {#if failed}
        <p
          class="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-background/90 px-3 py-1 text-sm text-destructive"
        >
          {t('region_map_failed')}
        </p>
      {/if}
    </div>

    <div class="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-4 sm:px-6">
      <Button variant="outline" onclick={() => (open = false)}>
        <X class="mr-1 h-4 w-4" />
        {t('region_cancel')}
      </Button>
      <Button disabled={region === null} onclick={() => region !== null && onconfirm(region)}>
        <Check class="mr-1 h-4 w-4" />
        {t('region_confirm')}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
