<script lang="ts">
  // The `feature` slot of the sheet registry: v3's feature sheet (WP-623: header, action row, Aktivität and Daten) and,
  // the task form (WP-643's `FormSheet`) in place of its body, in the same shell, once a task with a form starts (v3). A location step
  // of a task asks the map (`pickLocation`): the form hides while the person moves the pin or draws, and comes back.
  // Closing slides the shell out and unmounts the slot when the slide is over (v3 keeps the shell mounted).
  import { LAYER } from '../layers';
  import { onDestroy, untrack } from 'svelte';
  import type { FeatureId, Key } from '@ueberblick/core/model';
  import {
    isMobile,
    resolveLabel,
    type MapHandle,
    type Json,
    type LocationPicker,
    type LocationRequest,
  } from '@ueberblick/ui';
  import { placedRun, placingOf, type Placing } from '../feature/location-edit';
  import FeatureSheetHost from '../feature/FeatureSheetHost.svelte';
  import FormSheet from '../form/FormSheet.svelte';
  import LocationPick from '../form/LocationPick.svelte';
  import { slideOut } from '../form/slide-out.svelte';
  import { recentFly } from '../sheets/recent/fly';
  import { anchorOfFeature } from '../sheets/recent/recent';
  import { drawSpecOf } from '../sheets/create/creatable';
  import { message } from '../messages';
  import { taskTypeOf } from '../tools';
  import { afterCreate } from '../create/after-create';
  import { createFamilyIsolate } from './family';
  import { inheritRelations } from '@ueberblick/core/schema';
  import { mapStacks } from '../map/family-view';
  import { visibleOf } from '../sheets/filter/filtered-source';
  import { recordViewPassOf } from '../sheets/filter/view-pass';
  import type { SheetProps } from './sheets';

  let { ctx, onclose, featureId }: SheetProps = $props();
  const { device, locale } = $derived(ctx);
  // "Im Chat erwähnen" is offered to a person who has the chat on (v3 `chatAvailable`); the chat opens beside the feature.
  const chatOn = $derived(ctx.tools.entries.some((t) => t.key === 'chat' && t.on));

  let started: {
    taskKey: string;
    featureIds: readonly FeatureId[];
    initial?: Readonly<Record<string, Json>>;
  } | null = $state(null);
  // A task that edits the location goes straight onto the map (v3 `handleTaskInvoke` :583-606): the sheet steps aside.
  let placing: ({ taskKey: string; featureId: FeatureId } & Placing) | undefined = $state();
  let refusal: string | undefined = $state();
  const out = slideOut(() => onclose());
  onDestroy(() => out.cancel());
  // A relation whose children sit at their parent (B-019) fans them out above it; the others are isolated on the map.
  const family = untrack(() =>
    createFamilyIsolate({
      config: ctx.device.classified,
      facts: ctx.device.store.facts,
      geo: ctx.device.geo,
      handle: () => ctx.map,
      locale: ctx.locale,
      openFeature: (id) => ctx.openFeature(id),
      changed: ctx.device.changed,
    }),
  );
  onDestroy(() => family.dispose());
  // A tapped marker that anchors a headless stack (its parent is hidden by the filter) fans its siblings out (B-019).
  $effect(() => {
    const id = featureId;
    const viewKey = ctx.viewKey;
    if (id === undefined || viewKey === null) return;
    untrack(() => {
      const type = device.feature(id)?.type; // only a child that sits at its parent can anchor a headless stack
      if (type === undefined || !inheritRelations(device.config.file.types ?? {}).has(type)) return;
      const stacks = mapStacks({
        config: device.classified,
        facts: device.store.facts,
        geo: device.geo,
        source: device.viewSource(viewKey),
        visible: visibleOf(
          device.feature,
          device.classified,
          ctx.filter,
          recordViewPassOf(device, ctx.record),
        ),
      });
      family.stack(id, stacks.headless(id));
    });
  });
  let picking: { request: LocationRequest; resolve: (g: Json | undefined) => void } | undefined = $state();
  // The confirm pill is the task's button label (v3 :1591).
  const pillLabel = (key: string): string => {
    const def = device.config.file.tasks?.[key];
    return resolveLabel(def?.button?.label ?? def?.label, locale, key);
  };
  const drawOf = (taskKey: string, property: string) => {
    const type = taskTypeOf(device.config.file, taskKey);
    return drawSpecOf(
      type === undefined ? undefined : device.config.file.types?.[type]?.properties[property]?.geometry_type,
    );
  };
  const pickLocation: LocationPicker = (request) =>
    new Promise((resolve) => {
      picking = { request, resolve };
    });
  // v3 hides the bottom bar while a location is edited (`isEditingLocation`, BottomControlBar.svelte:66, set by
  // the v3 detail module, :286); the shell does it through `setPlacing`.
  $effect(() => {
    ctx.setPlacing(picking !== undefined || placing !== undefined);
    return () => ctx.setPlacing(false);
  });
  function settle(geometry: Json | undefined): void {
    picking?.resolve(geometry);
    picking = undefined;
  }
  // A map task started from a Liste row: the Liste closes, the map flies to the feature, then the task places (WP-783).
  let waiting: ({ taskKey: string; featureId: FeatureId } & Placing) | undefined;
  function beginPlacing(at: { taskKey: string; featureId: FeatureId } & Placing, map: MapHandle): void {
    const anchor = anchorOfFeature({ config: device.config, geo: device.geo }, device.feature(at.featureId));
    if (waiting !== undefined && anchor !== undefined)
      map.centerOn(
        anchor,
        recentFly({ phone: isMobile(), innerHeight: window.innerHeight, recentOpen: false }),
      );
    waiting = undefined;
    placing = at;
  }
  $effect(() => {
    const map = ctx.map;
    if (map !== undefined && waiting !== undefined) untrack(() => waiting && beginPlacing(waiting, map));
  });
  function openTask(taskKey: string, id: FeatureId): void {
    refusal = undefined;
    const plan = placingOf(device.config.file, taskKey);
    const at = plan === undefined ? undefined : { taskKey, featureId: id, ...plan };
    if (at !== undefined && ctx.map !== undefined) placing = at;
    else if (at !== undefined && ctx.listShown) {
      waiting = at;
      ctx.showMap();
    } else started = { taskKey, featureIds: [id] };
  }
  /** The confirm: the run is submitted (alone), or the form opens with the new geometry. A refusal shows its reason (v3 closes the sheet at once). */
  async function placed(geometry: Json | undefined): Promise<void> {
    const at = placing;
    placing = undefined;
    if (at === undefined || geometry === undefined) return;
    if (!at.alone) {
      started = { taskKey: at.taskKey, featureIds: [at.featureId], initial: { [at.property]: geometry } };
      return;
    }
    const run = placedRun(device.ids.runId(), at.taskKey, at.featureId, at.property, geometry);
    try {
      await device.submitter.submit(run);
      if (ctx.online) {
        const stop = device.submitter.outcome(run.id, (p) => {
          if (p.state === 'refused') refusal = p.reason; // already the plain sentence (`refusalText`, WP-686)
          if (p.state === 'refused' || p.state === 'accepted') queueMicrotask(() => stop());
        });
      }
    } catch {
      refusal = message(locale, 'feature_task_failed');
    }
  }
  /** A task of this feature made a child (v3 `+page.svelte:2345-2375`: the new object is selected): open it. */
  const created = (id: FeatureId): void =>
    afterCreate({
      id,
      type: started === null ? undefined : taskTypeOf(device.config.file, started.taskKey),
      filter: ctx.filter,
      openFeature: ctx.openFeature,
    });
  const currentOf = (at: { featureId: FeatureId; property: string }): Json | undefined =>
    (device.feature(at.featureId)?.properties as Record<string, Json> | undefined)?.[at.property];
</script>

{#snippet form()}
  {#if started !== null}
    <!-- v3: the task form replaces the body of the same shell (FormFillTool inside the detail module). Hidden, not
         removed, while the map is in use: the steps keep what the person entered. -->
    <FormSheet
      {device}
      taskKey={started.taskKey}
      featureIds={started.featureIds}
      {locale}
      online={ctx.online}
      center={ctx.center}
      {...ctx.map === undefined ? {} : { pickLocation }}
      {...started.initial === undefined ? {} : { initial: started.initial }}
      oncreated={created}
      onclose={() => (started = null)}
    />
  {/if}
{/snippet}

{#if featureId !== undefined}
  <FeatureSheetHost
    {device}
    {featureId}
    {locale}
    open={picking === undefined && placing === undefined && !out.leaving}
    onclose={() => out.close()}
    onform={openTask}
    onopen={(id) => ctx.openFeature(id)}
    isolate={family.isolate}
    {...chatOn ? { onmention: (id: FeatureId) => device.chat.mention(id) } : {}}
    {...started === null ? {} : { form }}
  />
{/if}

{#if picking !== undefined && started !== null && ctx.map !== undefined}
  <LocationPick
    handle={ctx.map}
    geo={device.geo}
    {locale}
    label={pillLabel(started.taskKey)}
    draw={drawOf(started.taskKey, picking.request.property)}
    current={picking.request.current}
    ondone={settle}
  />
{/if}

{#if placing !== undefined && ctx.map !== undefined}
  <LocationPick
    handle={ctx.map}
    geo={device.geo}
    {locale}
    label={pillLabel(placing.taskKey)}
    draw={drawOf(placing.taskKey, placing.property)}
    current={currentOf(placing)}
    ondone={(g) => void placed(g)}
  />
{/if}

{#if refusal !== undefined}
  <p
    role="alert"
    class={['fixed right-4 bottom-4 rounded-md bg-red-700 px-3 py-2 text-sm text-white', LAYER.menu]}
  >
    {refusal}
  </p>
{/if}
