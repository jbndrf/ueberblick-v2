<script lang="ts">
  // The filter sheet over fixed cards, presets and saved views. Test fixture only.
  import type { Key } from '@ueberblick/core/model';
  import FilterSheet from '../FilterSheet.svelte';
  import { createFilterController } from '../filter-controller';
  import type { FilterCard } from '../filter-model';
  import { memoryPrefs } from '../filter-state';

  const color = '#2b6cb0';
  const dot = { color, size: 32 };
  // WP-674: the Baum card draws the type's icon and the stage "erledigt" its icon; "erfasst" is a coloured dot.
  const own = { color: '#2f855a', size: 32, icon: { key: 'tree-deciduous' } };
  const done = { color: '#718096', size: 32, icon: { key: 'check' } };
  const cards: FilterCard[] = [
    {
      type: 'baum' as Key,
      label: 'Baum',
      count: 3,
      color: own.color,
      look: own,
      values: [
        {
          value: 'erfasst',
          label: 'Erfasst',
          count: 2,
          color: '#16a34a',
          look: { color: '#16a34a', size: 32 },
        },
        { value: 'kontrolliert', label: 'Kontrolliert', count: 0, color, look: dot },
        { value: 'erledigt', label: 'Erledigt', count: 1, color: done.color, look: done },
      ],
    },
    { type: 'bank' as Key, label: 'Bank', count: 1, color, look: dot, values: [] },
  ];
  const controller = createFilterController(memoryPrefs());
  let open = $state(true);
  let snapshot = $state('');
  let taps = $state(0);
  const show = (): void => {
    const s = controller.state();
    const v = controller.activeView();
    snapshot = JSON.stringify({
      hiddenTypes: [...s.hiddenTypes],
      hiddenValues: [...s.hiddenValues].map(([t, vs]) => [t, [...vs]]),
      active: v,
    });
  };
  controller.subscribe(show);
  show();
</script>

<button
  type="button"
  class="fixed top-1/2 right-0 z-10 h-12 w-14 border bg-white text-xs"
  onclick={() => (taps += 1)}>Karte</button
>
<pre data-testid="taps">{taps}</pre>
<pre data-testid="state">{snapshot}</pre>
<FilterSheet
  bind:open
  data={{ cards: () => cards, subscribe: () => () => undefined }}
  {controller}
  locale="de"
  views={{
    presets: [{ key: 'meine', label: 'Meine Bäume' }],
    saved: [{ id: 's1', name: 'Mein Filter' }],
    save: () => undefined,
    rename: () => undefined,
    remove: () => undefined,
  }}
  onManageTabs={() => undefined}
/>
