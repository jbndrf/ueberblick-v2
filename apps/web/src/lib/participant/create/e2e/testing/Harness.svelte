<script lang="ts">
  // Test fixture: the + flow over the real MapLibre map (no tiles), with the real bottom bar, picker, pin and pill. What
  // the shell does around them (`MapScreen`: the panel list, the bar that hides while a pin is placed) is done here
  // with the same pure helpers (`panels.ts`); the form is a stand-in that shows what it was opened with, with its rows from the real `buildFormModel`.
  import { onDestroy, onMount } from 'svelte';
  import { createGeo, type Geometry } from '@ueberblick/core/geo';
  import type { FeatureId } from '@ueberblick/core/model';
  import type { Candidate } from '../../chain';
  import type { View } from '@ueberblick/core/model';
  import type { FeatureSource, MapHandle } from '@ueberblick/ui';
  import { createMaplibreRenderer } from '../../../../../../../../packages/ui/src/map/maplibre/renderer';
  import { buildFormModel } from '../../../../../../../../packages/ui/src/form/model';
  import type { Property } from '@ueberblick/core/model';
  import BottomBar from '../../../shell/BottomBar.svelte';
  import { close, fabStep, stepFab, type Panels } from '../../../shell/panels';
  import type { Pill } from '../../../sheets/create/creatable';
  import CreateFlow from '../../../sheets/create/CreateFlow.svelte';

  const params = new URLSearchParams(location.search);
  const quotaReached = params.get('quota') === '1';
  // WP-677: `?chain=1` gives the Baum a parent to chain to, `?inherit=1` adds a type that sits at its parent
  const gebiet = { property: 'gebiet', parentType: 'gebiet' };
  const chain = params.get('chain') === '1' ? { chain: { relations: [gebiet], inherit: false } } : {};
  const candidates: Candidate[] = [
    { id: 'g1' as FeatureId, label: 'Gebiet Nord', at: [7.1, 50.7], relation: gebiet },
    { id: 'g2' as FeatureId, label: 'Gebiet Süd', at: [7.104, 50.703], relation: gebiet },
  ];
  const pills: Pill[] = [
    { taskKey: 'erfassen', label: 'Baum erfassen', onMap: true, ...chain },
    { taskKey: 'flaeche', label: 'Fläche anlegen', onMap: false, draw: { kind: 'polygon', multi: false } },
    { taskKey: 'baumart', label: 'Baumart anlegen', onMap: false },
    ...(params.get('inherit') === '1'
      ? [
          {
            taskKey: 'massnahme',
            label: 'Maßnahme anlegen',
            onMap: false,
            chain: { relations: [{ property: 'baum', parentType: 'baum' }], inherit: true },
          } satisfies Pill,
        ]
      : []),
  ];
  // The rows of the form, from the real form model: the position the pin placed is no row (WP-697), the other field is.
  const properties = {
    geometrie: { type: 'geometry' },
    beschreibung: { type: 'text' },
  } as unknown as Record<string, Property>;
  const rowsOf = (position: Geometry | undefined): string[] =>
    buildFormModel({
      form: { geometrie: {}, beschreibung: {} },
      properties,
      ...(position === undefined ? {} : { placed: { geometrie: position as never } }),
    }).fields.map((f) => f.key);
  const none: FeatureSource = { query: () => [], queryChunks: function* () {}, subscribe: () => () => {} };

  let box: HTMLElement | undefined = $state();
  let handle: MapHandle | undefined = $state();
  let open: Panels = $state([]);
  let placing = $state(false);
  let started: { taskKey: string; position: Geometry | undefined; parent?: string } | undefined = $state();
  const geo = createGeo();

  onMount(async () => {
    document.documentElement.style.setProperty('--ub-header-h', '3.5rem'); // MapScreen sets it in the app
    if (box === undefined) return;
    const h = createMaplibreRenderer().mount(box, { renderer: 'maplibre-2d' } as unknown as View, none);
    await h.ready;
    h.centerOn([7.1, 50.7], { zoom: 14 });
    handle = h;
  });
  onDestroy(() => handle?.destroy());
</script>

<div bind:this={box} data-testid="map" style="position:fixed;inset:0;background:#fff"></div>

<header
  class="fixed top-0 right-0 left-0 z-[1060] hidden h-[var(--ub-header-h)] items-center justify-end border-b bg-background px-4 md:flex"
>
  <button type="button" data-testid="header-plus" aria-label="Neu" onclick={() => (open = stepFab(open))}
    >+</button
  >
</header>

{#if handle !== undefined && open.includes('create') && started === undefined}
  <CreateFlow
    {pills}
    {handle}
    locale="de"
    {geo}
    open={true}
    position={open.includes('recent') ? 'left' : 'center'}
    {quotaReached}
    candidatesOf={() => candidates}
    onstart={(taskKey, position, parent) =>
      (started = {
        taskKey,
        position,
        ...(parent === undefined ? {} : { parent: `${parent.relation.property}=${parent.id}` }),
      })}
    onclose={() => (open = close(open, 'create'))}
    onbackdrop={() => (open = close(open, 'recent'))}
    onplacing={(on) => (placing = on)}
  />
{/if}

{#if open.includes('recent')}
  <aside
    data-testid="recent"
    class="fixed top-[var(--ub-header-h)] right-0 bottom-0 z-[1060] w-1/2 border-l bg-background p-4"
  >
    Zuletzt
  </aside>
{/if}

{#if started !== undefined}
  <div
    role="dialog"
    aria-label="Formular"
    data-testid="form"
    class="fixed right-0 bottom-0 left-0 z-[1100] h-[35vh] bg-background p-4"
  >
    <p data-testid="form-task">{started.taskKey}</p>
    <p data-testid="form-geometry">{JSON.stringify(started.position)}</p>
    <ul data-testid="form-rows">
      {#each rowsOf(started.position) as row (row)}<li>{row}</li>{/each}
    </ul>
    <p data-testid="form-parent">{started.parent ?? ''}</p>
  </div>
{/if}

{#if !placing}
  <BottomBar
    locale="de"
    toolsActive={false}
    fab={fabStep(open)}
    onbutton={(item) => item === 'create' && (open = stepFab(open))}
  />
{/if}
