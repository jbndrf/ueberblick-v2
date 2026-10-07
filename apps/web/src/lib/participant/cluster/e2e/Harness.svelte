<script lang="ts">
  // The cluster slot over a fixed device and a stand-in map (a button that must stay usable under the non-modal
  // shell, and a log of what the slot asked the map to do). Test fixture only.
  import type { ClusterTap } from '@ueberblick/ui';
  import type { FeatureState, Key } from '@ueberblick/core/model';
  import type { ShellContext } from '../../shell/sheets';
  import ClusterSlot from '../ClusterSlot.svelte';

  const params = new URLSearchParams(location.search);
  const baum = {
    label: { de: 'Baum', en: 'Tree' },
    geometry: 'geometry',
    process: { property: 'stage', start: 'erfasst', end: ['erledigt'] },
    // WP-674: the rows group by the classifying property and take the colour the map draws each value in.
    classify:
      params.get('by') === 'zustand'
        ? { property: 'zustand', values: { gut: { color: '#16a34a' }, schlecht: { color: '#dc2626' } } }
        : {
            property: 'stage',
            values: { erfasst: { color: '#16a34a' }, kontrolliert: { color: '#ca8a04' } },
          },
    properties: {
      zustand: { type: 'select', options: { gut: { de: 'Gut' }, schlecht: { de: 'Schlecht' } } },
      stage: {
        type: 'select',
        options: {
          erfasst: { de: 'Erfasst' },
          kontrolliert: { de: 'Kontrolliert' },
          erledigt: { de: 'Erledigt' },
        },
      },
    },
  };
  const bank = { label: { de: 'Bank' }, geometry: 'geometry', properties: {} };
  const stages = ['erfasst', 'erfasst', 'erfasst', 'kontrolliert', 'erledigt'];
  const states = new Map<string, FeatureState>();
  const ids: string[] = [];
  stages.forEach((stage, i) => {
    states.set(`b${i}`, {
      id: `b${i}`,
      type: 'baum' as Key,
      properties: { stage, zustand: i % 2 === 0 ? 'gut' : 'schlecht' },
      lifecycle: 'active',
    } as never);
    ids.push(`b${i}`);
  });
  if (params.get('types') !== '1') {
    states.set('k1', { id: 'k1', type: 'bank' as Key, properties: {}, lifecycle: 'active' } as never);
    ids.push('k1');
  }

  let open = $state(true);
  let mapTaps = $state(0);
  let log = $state('');
  let mapTapListener: (() => void) | undefined;
  const ctx = {
    device: { config: { file: { types: { baum, bank } } }, feature: (id: string) => states.get(id) },
    locale: 'de',
    map: {
      isolate: (x: readonly string[] | null) => (log += `isolate:${x === null ? 'null' : x.join(',')};`),
      onMapTap: (l: () => void) => {
        mapTapListener = l;
        return () => undefined;
      },
    },
  } as unknown as ShellContext;
  const cluster = {
    at: [8, 50],
    count: ids.length,
    members: ids.map((id) => ({ id, at: [8, 50] })),
  } as unknown as ClusterTap;
</script>

<button
  type="button"
  class="fixed top-20 left-4 z-10 rounded border p-2"
  data-testid="map"
  onclick={() => {
    mapTaps++;
    mapTapListener?.();
  }}>Karte</button
>
<p class="fixed bottom-2 left-2 z-10 text-xs" data-testid="result">taps={mapTaps} open={open}</p>
<pre data-testid="log" class="fixed top-2 left-2 z-10 text-xs">{log}</pre>
{#if open}
  <ClusterSlot {ctx} {cluster} onclose={() => (open = false)} />
{/if}
