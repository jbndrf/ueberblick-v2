<script lang="ts">
  // The real MapLibre renderer (no tiles) and a "Standort" button that does what the shell's `showStandort` does
  // (apps/web/src/lib/participant/shell/standort.ts: centre at POSITION_ZOOM, dot + accuracy overlay). Test fixture only.
  // `?acc=100` is the fix's accuracy in metres; `?fail=1` makes the device unable to tell.
  import { onDestroy, onMount } from 'svelte';
  import type { View } from '@ueberblick/core/model';
  import type { FeatureSource, MapHandle } from '../../../contract';
  import { POSITION_ZOOM } from '../../../controls';
  import { createMaplibreRenderer } from '../../../maplibre/renderer';

  const params = new URLSearchParams(location.search);
  const accuracy = Number(params.get('acc') ?? '100');
  const none: FeatureSource = { query: () => [], queryChunks: function* () {}, subscribe: () => () => {} };
  let box: HTMLElement | undefined = $state();
  let handle: MapHandle | undefined = $state();
  let failed = $state(false);

  onMount(async () => {
    if (box === undefined) return;
    const h = createMaplibreRenderer().mount(box, { renderer: 'maplibre-2d' } as unknown as View, none);
    await h.ready;
    h.centerOn([9, 48], { zoom: 12 });
    const zoom = (): void => void (document.body.dataset['zoom'] = String(h.extent()[2] - h.extent()[0]));
    h.onMove(zoom);
    zoom();
    handle = h;
  });
  onDestroy(() => handle?.destroy());

  function locate(): void {
    failed = params.get('fail') === '1';
    if (failed || handle === undefined) return;
    handle.centerOn([7.1, 50.7], { zoom: POSITION_ZOOM });
    handle.showOverlay(
      'standort',
      { type: 'Point', coordinates: [7.1, 50.7] },
      { color: '#4285F4', width: 5, accuracy },
    );
  }
  const more = (): void => handle?.zoomBy(1);
</script>

<div bind:this={box} style="position:fixed;inset:0;background:#fff"></div>
<div style="position:fixed;left:8px;top:8px;z-index:5;display:flex;gap:8px">
  <button type="button" onclick={locate}>Standort</button>
  <button type="button" onclick={more}>Zoom +1</button>
  {#if failed}<span role="status">Standort nicht verfügbar</span>{/if}
</div>
