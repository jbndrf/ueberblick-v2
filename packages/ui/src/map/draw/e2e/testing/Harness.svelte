<script lang="ts">
  // The real MapLibre renderer (no tiles) with the real DrawOnMap on top, German labels as v3. Test fixture only.
  // `?kind=polygon|linestring&multi=1` picks what is drawn; the result of Fertig and Abbrechen are printed.
  import { onDestroy, onMount } from 'svelte';
  import type { View } from '@ueberblick/core/model';
  import { createGeo, type Geometry } from '@ueberblick/core/geo';
  import type { FeatureSource, MapHandle } from '../../../contract';
  import { createMaplibreRenderer } from '../../../maplibre/renderer';
  import DrawOnMap from '../../DrawOnMap.svelte';
  import type { DrawLabels } from '../../labels';

  const params = new URLSearchParams(location.search);
  const kind = params.get('kind') === 'linestring' ? 'linestring' : 'polygon';
  const multi = params.get('multi') === '1';

  const labels: DrawLabels = {
    toolbar: 'Zeichenwerkzeug',
    cancel: 'Abbrechen',
    newPart: 'Neues Element',
    part: (n) => `Element ${n}`,
    undo: 'Rückgängig',
    redo: 'Wiederherstellen',
    delete: 'Element löschen',
    finish: 'Fertig',
    refused: (reason) => `Nicht übernommen: ${reason}.`,
    issues: {
      empty: 'die Form ist leer',
      hole_outside_shell: 'ein Loch liegt außerhalb der Fläche',
      nested_shells: 'Flächen überlappen sich',
      non_finite: 'eine Koordinate ist keine Zahl',
      out_of_range: 'eine Position liegt außerhalb der Welt',
      ring_not_closed: 'die Fläche ist nicht geschlossen',
      self_intersection: 'die Form überschneidet sich selbst',
      too_few_points: 'es gibt zu wenige Punkte',
      wrong_winding: 'die Fläche ist falsch herum ausgerichtet',
    },
  };

  const none: FeatureSource = { query: () => [], queryChunks: function* () {}, subscribe: () => () => {} };
  let box: HTMLElement | undefined = $state();
  let handle: MapHandle | undefined = $state();
  let result = $state('');
  const geo = createGeo();

  onMount(async () => {
    if (box === undefined) return;
    const h = createMaplibreRenderer().mount(box, { renderer: 'maplibre-2d' } as unknown as View, none);
    await h.ready;
    h.centerOn([9, 48], { zoom: 15 });
    // the width of the view in degrees: it changes with the zoom only (the e2e reads it)
    const width = (): void => void (document.body.dataset['zoom'] = String(h.extent()[2] - h.extent()[0]));
    h.onMove(width);
    width();
    handle = h;
  });
  onDestroy(() => handle?.destroy());
  const done = (g: Geometry): void => {
    result = JSON.stringify(g);
  };
</script>

<div bind:this={box} style="position: fixed; inset: 0" role="region" aria-label="Karte"></div>
{#if handle !== undefined}
  <DrawOnMap
    {handle}
    {geo}
    {kind}
    {multi}
    {labels}
    onconfirm={done}
    oncancel={() => (result = 'cancelled')}
  />
{/if}
<pre
  data-testid="result"
  style="position: fixed; bottom: 8px; left: 8px; z-index: 2000; background: #fff; font-size: 0.75rem">{result}</pre>
