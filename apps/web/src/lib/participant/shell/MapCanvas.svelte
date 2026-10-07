<script lang="ts">
  // The map: v3's only working screen (`MapCanvas.svelte`). It draws one view with the headless renderer (MapLibre
  // loads on mount, clusters stay) and reports taps on features. v3 had no zoom buttons, so none is drawn.
  // The list of the view's features stands in for the map when none can be drawn (no WebGL, no drawable layer; the
  // reason is said, never only on the console). The small List toggle is kept from the first build as the keyboard and
  // screen-reader way to a feature (WCAG 2.1.1; a map canvas has no keyboard path to a marker). v3 has no such
  // element: its place is an open question for the lead (WP-620 Notes).
  import { LAYER } from '../layers';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { RENDERERS } from '@ueberblick/core/registry';
  import { drawnLooks } from '../view-source';
  import { ALL, type Changed } from '../changed';
  import type { FeatureId, Key, View } from '@ueberblick/core/model';
  import {
    createRendererMap,
    describeMap,
    getRenderer,
    THEMES,
    type ListColumn,
    type MapHandle,
    type PackRouting,
  } from '@ueberblick/ui';
  import type { Device } from '../device';
  import type { FilterController } from '../sheets/filter/filter-controller';
  import { withDefaultBase, type LayerController } from '../sheets/layer/layer-controller';
  import { filteredSource, visibleOf } from '../sheets/filter/filtered-source';
  import { mapStacks } from '../map/family-view';
  import { recordViewPassOf } from '../sheets/filter/view-pass';
  import type { PrefsClient } from '@ueberblick/client';
  import { message, type Locale } from '../messages';
  import { drawableView } from '../map-view';
  import { viewHasLocations, withStartCamera } from './initial-view';
  import { typeLabelOf } from '../tools';
  import ListView from '../list/ListView.svelte';
  import { createExtentHold } from '../list/extent';
  import { groupRows } from '../list/groups';
  import { createChunkedReader } from '../list/chunked-read';
  import { deviceListLookup, listColumns } from './list-columns';
  import type { ListRow } from '../view-source';

  interface Props {
    device: Device;
    viewKey: string;
    /** The Karteninhalt switches; a hidden Objektart or stage is never given to the renderer. */
    filter: FilterController;
    /** The Kartenlayer choice: the base and overlays drawn below the features. */
    layers: LayerController;
    /** The person's preference record: the saved filters an active view may be (`filters.saved`). */
    record: Pick<PrefsClient, 'current'>;
    locale: Locale;
    onfeature: (id: FeatureId) => void;
    /** The feature whose sheet is open: the map marks it. */
    selected?: FeatureId | null;
    /** The role's theme: the mark's colour is its `color.focus` token, never the renderer's own. */
    theme: keyof typeof THEMES;
    onhandle: (handle: MapHandle | undefined) => void;
    /** The offline-pack tile protocol of this device: a layer with a pack on the device is read from it. */
    packProtocol?: PackRouting;
    /** Rings when the packs on the device change; the basemaps are applied again so they route through (or off) the packs. */
    onPacksChange?: (run: () => void) => () => void;
    /** Whether the list stands in for the map (tools that need a visible map are not offered then). */
    onlist?: (shown: boolean) => void;
    /** The map is settled for the first time, or cannot be drawn (the list stands in): loading is over (v3 `isLoading`). */
    onidle?: () => void;
  }
  let {
    device,
    viewKey,
    filter,
    layers,
    record,
    locale,
    onfeature,
    selected = null,
    theme,
    onhandle,
    onlist,
    onidle,
    packProtocol,
    onPacksChange,
  }: Props = $props();

  const view = $derived(device.config.file.views?.[viewKey]);
  let el: HTMLDivElement | undefined = $state();
  let handle: MapHandle | undefined;
  let drawn: MapHandle | undefined = $state(); // the same handle, reactive: the highlight follows `selected` once the map exists
  let failed = $state(false);
  let listOn = $state(false);
  const listShown = $derived(failed || listOn);
  /** Closes the Liste so the map shows (a map task started from a Liste row, WP-783). */
  export function showMap(): void {
    if (!listOn) return;
    listOn = false;
    onlist?.(false);
  }
  let features: readonly ListRow[] = $state([]);
  const stops: (() => void)[] = [];
  const hold = createExtentHold(); // the Liste's extent: never the one of a map hidden behind it

  /** The columns of an Objektart: the view's own for its source type, else the first three properties (v3 shows no more). Cells go through `formatProperty` (WP-713). */
  const columnsOf = (typeKey: string): ListColumn[] =>
    listColumns(
      device.config.file,
      {
        source: { type: typeKey },
        properties: typeKey === view?.source.type ? view?.properties : undefined,
      },
      locale,
      deviceListLookup(device, locale),
    );
  const groups = $derived(
    groupRows(
      features,
      (id) => device.feature(id)?.type,
      (t) => typeLabelOf(device.config.file, locale)(t as Key),
      columnsOf,
    ),
  );

  const viewPass = $derived(recordViewPassOf(device, record));
  const viewSource = $derived(device.viewSource(viewKey));
  // Family stacks over the filter-visible set (B-019): a child shows at its parent when the parent is hidden by the filter.
  const stacks = $derived(
    mapStacks({
      config: device.classified,
      facts: device.store.facts,
      geo: device.geo,
      source: viewSource,
      visible: (id) => visible(id),
    }),
  );
  const source = $derived(
    filteredSource(
      viewSource,
      device.feature,
      device.classified,
      filter,
      viewPass,
      (id) => stacks.hidden(id),
      (id) => stacks.shownOpenCount(id),
    ),
  );
  const list = $derived(device.viewList(viewKey));
  // The Liste shows what the map shows: the same filter predicate (R1) over the rows. One predicate for the life of the
  // view and the person's roles, so its compiled filters are kept between refreshes (WP-800).
  const visible = $derived(visibleOf(device.feature, device.classified, filter, viewPass));
  /**
   * Reads the rows again. A hidden Liste does no work (WP-800, R14): it is read in full when it is shown. Shown, a burst
   * that names its features replaces only those rows; no ids at all (a queue change that moved nothing) changes nothing.
   */
  const reader = createChunkedReader();
  const refresh = (changed: Changed = ALL): void => {
    if (!listShown) return reader.cancel();
    const extent = hold.read(() => handle?.extent(), listShown);
    // The first full read is chunked (WP-805): slices with a yield between; a new read, or a burst while one runs, restarts it.
    if (changed === ALL || reader.running) {
      void reader
        .read(list.rowChunks(extent), (slice) => list.rename(slice, [locale]).filter((r) => visible(r.id)))
        .then((rows) => {
          if (rows !== undefined) features = rows;
        });
      return;
    }
    if (changed.size === 0) return;
    const fresh = new Map(list.rename(list.rowsOf(changed, extent), [locale]).map((r) => [r.id, r]));
    const next: ListRow[] = [];
    for (const r of features) {
      if (!changed.has(r.id)) next.push(r);
      else {
        const again = fresh.get(r.id);
        if (again !== undefined && visible(r.id)) next.push(again);
        fresh.delete(r.id);
      }
    }
    for (const r of fresh.values()) if (visible(r.id)) next.push(r);
    features = next;
  };
  // A language switch re-labels the rows shown; it does not read the facts again (WP-761).
  $effect(() => {
    const names = [locale];
    untrack(() => (features = list.rename(features, names)));
  });

  // MapLibre's worker is copied into the build by `vite.config.ts` (the library build does not emit it beside itself).
  const WORKER_URL = `/_app/immutable/maplibre-gl-${__MAPLIBRE_VERSION__}/maplibre-gl-worker.mjs`;

  let gone = false;

  async function mountMap(node: HTMLElement, shown: View): Promise<void> {
    // The worker URL is set before the renderer creates its map, so the map never looks for it beside the library.
    const ml = await import('maplibre-gl');
    ml.setWorkerUrl(WORKER_URL);
    if (gone) return;
    const layer = Object.values(shown.layers ?? {})[0];
    const renderer = getRenderer(
      createRendererMap(new Map(), {
        // Tiles come from this project's proxy on this origin, never from a provider (A-033, GDPR).
        proxy: { project: device.project, origin: location.origin },
        ...(packProtocol === undefined ? {} : { packProtocol }),
      }),
      layer?.renderer ?? RENDERERS.keys[0],
    );
    const h = renderer.mount(
      node,
      withStartCamera(
        shown,
        device.config.file.map?.start,
        viewHasLocations(shown, device.config.file.types),
      ),
      source,
    );
    handle = h;
    drawn = h;
    stops.push(describeMap(node, mapLabels()));
    onhandle(h);
    const { min_zoom: min, max_zoom: max } = device.config.file.map ?? {}; // the project's zoom limits (A-036)
    h.setZoomBounds?.({ ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) });
    // The backgrounds of the person's roles, and each change of the choice; only what changed is redrawn.
    const drawBasemaps = (): void => {
      const drawn = withDefaultBase(layers.map(), layers.selection());
      h.setBasemaps?.(drawn.map, drawn.selection);
    };
    drawBasemaps();
    stops.push(layers.subscribe(drawBasemaps));
    // A new config object makes the renderer take the layers off and put them on again, now routed by what the
    // device holds: a pack that was just stored is used at once, a deleted one is not.
    if (onPacksChange !== undefined) {
      stops.push(
        onPacksChange(() => {
          const drawn = withDefaultBase(layers.map(), layers.selection());
          h.setBasemaps?.({ ...drawn.map }, drawn.selection);
        }),
      );
    }
    // The Liste's extent follows the map; its rows are read when it is shown (WP-800).
    const holdExtent = (): void => void hold.read(() => handle?.extent(), listShown);
    stops.push(h.onFeatureTap(onfeature), h.onExtentChange(holdExtent));
    // Test seam (WP-585): where the map is settled, on the container. The renderer reports the extent only when
    // it has, so this is written when the map is ready and on every `moveend`; the e2e reads it instead of
    // decoding the canvas.
    const settle = (): void => {
      if (gone || el === undefined || handle === undefined) return;
      const [w, s, e, n] = handle.extent();
      el.dataset.center = `${(w + e) / 2},${(s + n) / 2}`;
      el.dataset.span = String(e - w); // degrees of longitude in view: the e2e derives the zoom from it (WP-730)
      el.dataset.idle = 'true';
      onidle?.();
    };
    stops.push(h.onExtentChange(settle));
    void h.ready.then(settle).catch(() => undefined);
    h.ready.catch((e: unknown) => mapFailed(e));
    holdExtent();
  }

  /** The list stands in for the map, and the reason is said in the app. */
  function mapFailed(e: unknown): void {
    failed = true;
    refresh();
    onlist?.(true);
    onidle?.();
    handle = undefined; // no map to tap on: tools that need one are not offered
    drawn = undefined;
    onhandle(undefined);
    device.problems.report({
      code: 'map_unavailable',
      subject: viewKey,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  onMount(() => {
    if (el === undefined || view === undefined) return;
    refresh(); // the list has the features before the map is up
    stops.push(filter.subscribe(() => refresh())); // a switch changes the Liste at once
    stops.push(device.changed.subscribe(refresh)); // the list follows the device whether or not a map is drawn
    const shown = drawableView(view);
    // A layer whose style is an unresolved `$ref` is not drawn, and each one is reported by its key (R11).
    for (const u of shown.unresolved)
      device.problems.report({ code: 'style_unresolved', subject: u.layer, detail: u.ref });
    if (!shown.drawable) {
      failed = true;
      refresh();
      onlist?.(true);
      onidle?.();
      return;
    }
    mountMap(el, shown.view).catch((e: unknown) => mapFailed(e));
  });

  onDestroy(() => {
    gone = true;
    stops.forEach((s) => s());
    handle?.destroy();
    onhandle(undefined);
    onlist?.(false);
  });

  // On when the sheet opens, off when it closes, moved when another feature opens (a relation path, Zuletzt): v3 set the
  // feature-state of one feature (`MapCanvas.svelte:980-993`), the renderer filters its highlight layers on the id.
  $effect(() =>
    drawn?.setSelected?.(selected === null ? null : { id: selected, color: THEMES[theme].color.focus }),
  );

  // The icons and colours of every Objektart the view draws (v3 registered all of them in one symbol layer, WP-744), by
  // value (WP-674). Applied once the map exists and again when the config is replaced; the source data is not rewritten.
  $effect(() => drawn?.setLooks?.(drawnLooks(device.classified, viewKey)));

  const mapLabels = () => ({
    map: message(locale, 'map_name'),
    mapDescription: message(locale, 'map_description'),
  });

  const labels = $derived({
    caption: message(locale, 'list_caption'),
    empty: message(locale, 'list_empty'),
    sortedAscending: message(locale, 'list_asc'),
    sortedDescending: message(locale, 'list_desc'),
  });
</script>

<div class="relative h-full w-full">
  {#if !failed}
    <Button
      variant="outline"
      size="sm"
      class={['absolute top-3 left-3 min-h-11 dark:bg-background dark:hover:bg-accent', LAYER.mapControl]}
      aria-pressed={listOn}
      onclick={() => {
        listOn = !listOn;
        onlist?.(listOn);
        refresh();
      }}>{message(locale, 'list_show')}</Button
    >
  {/if}
  {#if failed}<p role="status" class="p-4 text-sm text-muted-foreground">
      {message(locale, 'map_failed')}
    </p>{/if}
  <!-- The Liste ends above the phone bottom bar (h-16, md:hidden), as the sheets do (WP-790). -->
  <!-- touch-action: a gesture on the map is the map's (pan, pinch) and never zooms the page (viewport meta allows page zoom, WCAG 1.4.4) -->
  <div
    class="h-full w-full touch-none"
    bind:this={el}
    hidden={listShown}
    data-testid="map"
    data-selected={selected ?? undefined}
  ></div>
  {#if listShown}
    <div class="absolute inset-x-0 top-[var(--ub-header-h)] bottom-16 overflow-auto p-4 md:bottom-0">
      {#if features.length === 0}
        <p class="text-sm text-muted-foreground">{labels.empty}</p>
      {:else}
        <ListView heading={labels.caption} {groups} {labels} sort={view?.sort ?? []} {onfeature} />
      {/if}
    </div>
  {/if}
</div>
