<script lang="ts">
  // Test fixture (WP-677): the family fan over the real MapLibre map (no tiles). A parent sits in the middle of the map;
  // `?n=` children sit at it (default 7), `?scene=family`. The fan, the chip and what a tap on them reports are real; the
  // sheet that opens the relation is replaced by the button "Beziehung öffnen", and what the fan opens is shown.
  import { onDestroy, onMount } from 'svelte';
  import type { FeatureId } from '@ueberblick/core/model';
  import type { View } from '@ueberblick/core/model';
  import {
    createFamilyFan,
    fanOf,
    markerSvgUrl,
    type FamilyFan,
    type FeatureSource,
    type MapHandle,
  } from '@ueberblick/ui';
  import { createMaplibreRenderer } from '../../../../../../../../packages/ui/src/map/maplibre/renderer';

  const params = new URLSearchParams(location.search);
  const count = Number(params.get('n') ?? 7);
  const none: FeatureSource = { query: () => [], queryChunks: function* () {}, subscribe: () => () => {} };
  const AT: [number, number] = [7.1, 50.7];

  let box: HTMLElement | undefined = $state();
  let handle: MapHandle | undefined = $state();
  let fan: FamilyFan | undefined;
  let opened = $state('');

  function show(): void {
    if (handle === undefined) return;
    fan ??= createFamilyFan(handle);
    const inputs = Array.from({ length: count }, (_, i) => ({
      id: `m${i}` as FeatureId,
      active: i % 2 === 0,
    }));
    const { fanned, overflow } = fanOf(inputs);
    const url = markerSvgUrl({ color: '#2563eb', size: 24 });
    fan.open({
      parent: 'b1' as FeatureId,
      at: AT,
      parentIconHeight: 12,
      items: fanned.map((f) => ({
        id: f.id,
        label: `Maßnahme ${f.id}`,
        icon: { url, width: 22, height: 22 },
      })),
      overflow,
      overflowLabel: `Alle ${count} verknüpften Einträge anzeigen`,
      onChild: (id) => (opened = id),
      onOverflow: (id) => (opened = `parent ${id}`),
    });
  }

  onMount(async () => {
    if (box === undefined) return;
    const h = createMaplibreRenderer().mount(box, { renderer: 'maplibre-2d' } as unknown as View, none);
    await h.ready;
    h.centerOn(AT, { zoom: 14 });
    const dot = document.createElement('div');
    dot.style.cssText = 'width:24px;height:24px;border-radius:50%;background:#16a34a;border:2px solid #fff';
    h.addMarker('parent', AT, { element: dot });
    handle = h;
  });
  onDestroy(() => handle?.destroy());
</script>

<div bind:this={box} data-testid="map" style="position:fixed;inset:0;background:#fff"></div>
<button
  type="button"
  data-testid="open-relation"
  class="fixed top-4 left-4 z-[1100] min-h-11 rounded border bg-background px-3"
  onclick={show}>Beziehung öffnen</button
>
<button
  type="button"
  data-testid="close-relation"
  class="fixed top-4 right-4 z-[1100] min-h-11 rounded border bg-background px-3"
  onclick={() => fan?.close()}>Beziehung schließen</button
>
<p data-testid="opened" class="fixed bottom-4 left-4 z-[1100] bg-background">{opened}</p>
