<script lang="ts">
  // The filter sheet with its Cluster tab over a real preference record (localStorage, offline) and a stand-in map
  // that runs the real cluster worker code on 30 close features: it applies the person's switch and cap exactly as
  // `MapScreen` does (`unclusterCap`) and shows what it would draw. Test fixture only.
  import { createPrefsClient, webKeyValueStorage } from '@ueberblick/client';
  import type { TemplateFile } from '@ueberblick/core/model';
  import type { UnclusterStats } from '@ueberblick/ui';
  import {
    ClusterClient,
    createInProcessTransport,
  } from '../../../../../../../../../packages/ui/src/map/cluster/client';
  import FilterSheet from '../../FilterSheet.svelte';
  import { createFilterController } from '../../filter-controller';
  import { memoryPrefs } from '../../filter-state';
  import { message } from '../../../../messages';
  import ClusterTab from '../ClusterTab.svelte';
  import { CLUSTER_TOOL, clusterPrefs, unclusterCap } from '../../../../tools/cluster';
  import { toolEntries } from '../../../../tools/entries';
  import { createToolPerson } from '../../../../tools/person';

  const file = { roles: { k: { label: 'K', app: {} } }, tools: { cluster: {} } } as unknown as TemplateFile;
  const prefs = createPrefsClient({
    storage: webKeyValueStorage(localStorage),
    transport: {
      fetch: () => Promise.reject(new Error('offline')),
      send: () => Promise.reject(new Error('offline')),
    },
    clock: { now: () => new Date().toISOString() },
    project: 'p',
    participant: 'u',
  });
  const person = createToolPerson({ file, roleKey: 'k', prefs });

  // 30 features within a few metres of each other, in view at zoom 5
  const client = new ClusterClient(createInProcessTransport());
  client.apply({
    add: Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}` as never,
      anchor: [10 + i * 0.0002, 50] as [number, number],
      geometry: { type: 'Point', coordinates: [10 + i * 0.0002, 50] } as never,
      properties: {},
    })),
    update: [],
    remove: [],
  });
  let stats: UnclusterStats | undefined;
  const listeners = new Set<(s: UnclusterStats) => void>();
  const map = {
    onUnclusterStats(l: (s: UnclusterStats) => void) {
      if (stats !== undefined) l(stats);
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  let drawn = $state('');
  async function apply(): Promise<void> {
    const entries = toolEntries(file, 'k', person.switches());
    const cap = unclusterCap(entries, clusterPrefs(person.preferencesOf(CLUSTER_TOOL)));
    const a = await client.queryCapped([-180, -90, 180, 90], 5, cap ?? undefined);
    const groups = a.items.filter((i) => i.count !== undefined).length;
    drawn = `${a.items.length - groups} singles, ${groups} groups`;
    stats = cap === null ? undefined : a.stats;
    if (stats !== undefined) for (const l of listeners) l(stats);
  }
  person.subscribe(() => void apply());
  void apply();

  const controller = createFilterController(memoryPrefs());
  let open = $state(true);
  let switches = $state(person.switches());
  person.subscribe(() => (switches = person.switches()));
  const extraTabs = $derived(
    toolEntries(file, 'k', switches).some((e) => e.key === CLUSTER_TOOL && e.on)
      ? [{ key: CLUSTER_TOOL, label: message('de', 'tool_cluster_tab'), body: clusterBody }]
      : [],
  );
</script>

{#snippet clusterBody()}
  <ClusterTab locale="de" {person} {map} />
{/snippet}

<pre data-testid="drawn">{drawn}</pre>
<button
  type="button"
  data-testid="tool-off"
  class="fixed right-0 bottom-0 z-10 border bg-white p-2 text-xs"
  onclick={() => person.setSwitch(CLUSTER_TOOL, false)}>Werkzeug aus</button
>
<FilterSheet
  bind:open
  data={{ cards: () => [], subscribe: () => () => undefined }}
  {controller}
  locale="de"
  {extraTabs}
  onManageTabs={() => undefined}
/>
