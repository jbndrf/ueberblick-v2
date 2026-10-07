<script lang="ts">
  // The `create` slot: Neu (v3 `WorkflowSelector` at `/map`). + opens the picker; a point type goes through the pin,
  // a line or an area through the drawing, and the create form (the shared shell, WP-643) opens with that position as
  // the geometry (v3 `onWorkflowSelect(workflow, coordinates)`). The slot stays until the form is over.
  import type { Geometry } from '@ueberblick/core/geo';
  import type { FeatureId } from '@ueberblick/core/model';
  import { quotaOfRoles } from '@ueberblick/core/plan';
  import type { Json } from '@ueberblick/ui';
  import { afterCreate } from '../create/after-create';
  import FormShell from '../form/FormShell.svelte';
  import { candidatesIn, type Candidate } from '../create/chain';
  import CreateFlow from '../sheets/create/CreateFlow.svelte';
  import { creatablePills } from '../sheets/create/creatable';
  import { taskTypeOf } from '../tools';
  import type { SheetProps } from './sheets';

  let { ctx, onclose }: SheetProps = $props();
  const { device, locale } = $derived(ctx);

  const pills = $derived(
    creatablePills({ config: device.config, startable: device.reader.startableTasks(), locale }),
  );
  // v3 `quotaReached` (+page.svelte:698): the highest quota among the person's roles against what they created. The
  // count stops at the quota (core `Facts.createdBy`), so it never scans the features (R14).
  const quotaReached = $derived.by(() => {
    const quota = quotaOfRoles(device.config.file, device.actor.roles);
    return quota !== undefined && device.store.facts.createdBy(device.actor.id, quota) >= quota;
  });

  // `$state.raw`: `started` is replaced as a whole and its `initial` flows into the run input, which IndexedDB must be
  // able to clone: a deep `$state` would hand the form a Proxy of the pin position (WP-696).
  let started: { taskKey: string; initial: Readonly<Record<string, Json>> } | undefined = $state.raw();

  /** The picker or a pin placement is dismissed: with a form open only the picker goes (v3), else the slot. */
  const dismiss = (): void => (started === undefined ? onclose() : ctx.setForm(true));

  /** The run made a feature (v3 `+page.svelte:2321-2359`): open its detail and show its type if it was hidden. */
  const created = (id: FeatureId): void =>
    afterCreate({
      id,
      type: started === undefined ? undefined : taskTypeOf(device.config.file, started.taskKey),
      filter: ctx.filter,
      openFeature: ctx.openFeature,
    });

  /**
   * The position goes into the property the type holds its geometry in; a type without one starts empty. A parent
   * picked while placing (WP-677, "Mit Eltern-Element verketten") fills the reference to it: the form opens with the
   * parent linked (v3 armed `pendingChildLink`).
   */
  function start(taskKey: string, position: Geometry | undefined, parent?: Candidate): void {
    const type = taskTypeOf(device.config.file, taskKey);
    const property =
      type === undefined ? undefined : device.config.foldTypes.get(type as never)?.primaryGeometry;
    ctx.setForm(true);
    started = {
      taskKey,
      initial: {
        ...(position === undefined || property === undefined
          ? {}
          : { [property]: position as unknown as Json }),
        ...(parent === undefined ? {} : { [parent.relation.property]: parent.id as Json }),
      },
    };
  }
</script>

{#if started !== undefined}
  {#key started}
    <FormShell
      {device}
      taskKey={started.taskKey}
      featureIds={[]}
      {locale}
      online={ctx.online}
      center={ctx.center}
      initial={started.initial}
      oncreated={created}
      {onclose}
    />
  {/key}
{/if}

{#if started === undefined || ctx.pickerShown}
  <CreateFlow
    {pills}
    handle={ctx.map}
    {locale}
    geo={device.geo}
    open={true}
    position={ctx.recentOpen ? 'left' : 'center'}
    {quotaReached}
    candidatesOf={(chain, extent, around) =>
      candidatesIn(
        { config: device.config, facts: device.store.facts, geo: device.geo, locale },
        chain,
        extent,
        around,
      )}
    onstart={start}
    onclose={dismiss}
    onbackdrop={() => ctx.closeSlot('recent')}
    onplacing={ctx.setPlacing}
  />
{/if}
