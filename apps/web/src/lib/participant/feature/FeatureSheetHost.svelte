<script lang="ts">
  // The feature sheet on the device: reads the feature through the reader, keeps itself current when the device says
  // features changed, and handles a tap on an action (`startTask`: a task without a form submits here, one with a form
  // is handed to the host app, which opens the task sheet).
  import { LAYER } from '../layers';
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { FeatureId, Key } from '@ueberblick/core/model';
  import { Sheet, resolveLabel, type ActivityView } from '@ueberblick/ui';
  import type { Device } from '../device';
  import { message, type Locale } from '../messages';
  import { fieldLabelOf } from '../refusals';
  import FeatureSheet from './FeatureSheet.svelte';
  import ActivityTab from './activity/ActivityTab.svelte';
  import FeatureNotices from './notices/FeatureNotices.svelte';
  import { createRelationNav, focusOf } from './relations/nav';
  import RelationList from './relations/RelationList.svelte';
  import RelationPath from './relations/RelationPath.svelte';
  import { openQuickEdit, type QuickEdit, type QuickEditDevice } from './quick-edit.svelte';
  import { activityFor, sheetModelFor, startTask } from './sheet-data';
  import { presentTasks } from './task-presentation';

  type SheetDevice = Pick<Device, 'clock' | 'changed' | 'queue'> & QuickEditDevice;
  interface Props {
    device: SheetDevice;
    featureId: FeatureId;
    locale: Locale;
    /** False while the task sheet is open over this one. */
    open: boolean;
    onclose: () => void;
    onform: (task: Key, feature: FeatureId) => void;
    onopen: (id: FeatureId) => void;
    /** A task form in place of the sheet's body, in the same shell. */
    form?: Snippet;
    /** The map's drill-down (`MapHandle.isolate`, v3 `onFocusRelation`): draws only these features, `null` ends it. */
    isolate?: (ids: readonly FeatureId[] | null) => void;
    /** "Im Chat erwähnen" for the open feature (the header ⋮ menu); given only when the person has the chat. */
    onmention?: (id: FeatureId) => void;
  }
  let { device, featureId, locale, open, onclose, onform, onopen, form, isolate, onmention }: Props =
    $props();

  // Bumped when features may have changed, so the open sheet shows the current state.
  let tick = $state(0);
  let failed = $state(false);
  onMount(() => device.changed.subscribe(() => tick++));

  // The relation path and level (WP-647, v3 `relation-nav`): where this Objekt sits, its children per relation. Read from
  // the device when drawn; the open-work counts follow once the sheet is on screen, so they never delay opening it (R14).
  const nav = $derived.by(() => {
    void tick;
    return createRelationNav({ source: device.reader, file: device.config.file, locale });
  });
  const chains = $derived(nav.chains(featureId));
  /** The relation of this Objekt shown in the body (v3 `relationView`), and where a tap on a path segment goes next. */
  let openGroup: string | undefined = $state();
  let pending: { feature: FeatureId; group?: string; via?: FeatureId } | undefined;
  let via: FeatureId | undefined = $state();
  let picked: number | undefined = $state();
  // Several parents: the chain the person came down, else the first (v3 `preferredParentId`).
  const chainIndex = $derived(
    picked ??
      Math.max(
        0,
        chains.findIndex((c) => c.at(-1)?.parent === via),
      ),
  );
  $effect(() => {
    const id = featureId;
    untrack(() => {
      const arrived = pending?.feature === id ? pending : undefined;
      pending = undefined;
      openGroup = arrived?.group;
      via = arrived?.via;
      picked = undefined;
    });
  });
  // v3 keeps the map fanned on the relation in view (`onFocusRelation`, Module :447-455): the open relation level, or the
  // relation this Objekt was reached through (its siblings stay drawn). Leaving it, or closing the sheet, ends it.
  const focus = $derived(focusOf(nav, featureId, openGroup, chains[chainIndex]));
  const focusKey = $derived(focus === null ? null : focus.join('|'));
  $effect(() => {
    const key = focusKey;
    untrack(() => isolate?.(key === null ? null : (focus ?? null)));
  });
  $effect(() => () => untrack(() => isolate?.(null)));

  let settled = $state(false);
  $effect(() => {
    void featureId;
    void tick;
    settled = false;
    const timer = setTimeout(() => (settled = true), 0);
    return () => clearTimeout(timer);
  });
  const openWork = (parent: FeatureId, group?: string): number => (settled ? nav.openWork(parent, group) : 0);
  const leads = (id: FeatureId): boolean => settled && nav.leadsToOpenWork(id);
  const fieldLabel = $derived(fieldLabelOf(device.config.file, locale));
  const taskLabel = (key: string): string =>
    resolveLabel(device.config.file.tasks?.[key]?.label, locale, key);

  function goTo(id: FeatureId, group?: string, from?: FeatureId): void {
    pending = {
      feature: id,
      ...(group === undefined ? {} : { group }),
      ...(from === undefined ? {} : { via: from }),
    };
    onopen(id);
  }
  function openGroupOf(parent: FeatureId, group: string): void {
    if (parent === featureId) openGroup = group;
    else goTo(parent, group);
  }
  function create(group: string): void {
    const offer = nav.offer(featureId, group);
    if (offer !== undefined) void start(offer.task);
  }

  // The timeline reads the runs of this feature from memory: load them before the sheet opens, so the tab does not
  // stall on first open (WP-602 `warmActivity`). A feature that is not here fails the load; the sheet then says so.
  let warm = $state(false);
  $effect(() => {
    const id = featureId;
    warm = false;
    void device.reader
      .warmActivity(id)
      .catch(() => undefined)
      .then(() => {
        if (id === featureId) warm = true;
      });
  });

  const model = $derived.by(() => {
    void tick;
    const base = sheetModelFor(device, featureId, locale);
    // The label, colour, icon and confirmation the admin gave each task (WP-616).
    return base === undefined
      ? undefined
      : { ...base, tasks: presentTasks(base.tasks, device.config.file, locale) };
  });

  // An inline quick edit in progress (a task whose only step is `quick_edit`): the Daten tab is editable in place.
  let quick: QuickEdit | undefined = $state();

  // Read when the Aktivität tab draws (and again when features changed), so a hidden tab costs nothing.
  function timelineView(): ActivityView {
    void tick;
    return activityFor(device, featureId, locale) ?? { segments: [] };
  }

  async function start(task: Key): Promise<void> {
    failed = false;
    try {
      const started = await startTask(device, task, featureId);
      if (started === 'form') onform(task, featureId);
      else if (started === 'quick_edit')
        quick = openQuickEdit(device, task, featureId, locale, () => (quick = undefined));
    } catch {
      failed = true;
    }
    tick++;
  }

  async function save(): Promise<void> {
    failed = false;
    try {
      await quick?.save();
    } catch {
      failed = true;
    }
    tick++;
  }
</script>

{#snippet timeline(showData: () => void)}
  <ActivityTab view={timelineView()} {locale} now={device.clock.now()} onshowdata={showData} />
{/snippet}

{#snippet path()}
  <RelationPath
    {nav}
    id={featureId}
    title={model?.typeLabel ?? ''}
    {locale}
    {openGroup}
    {chains}
    {chainIndex}
    {openWork}
    onselectchain={(i) => (picked = i)}
    onopen={(id) => goTo(id)}
    onopengroup={openGroupOf}
    onclosegroup={() => (openGroup = undefined)}
    oncreate={create}
  />
{/snippet}

{#snippet notices()}
  <FeatureNotices {device} {featureId} {locale} {taskLabel} {fieldLabel} />
{/snippet}

{#snippet level()}
  {#if openGroup !== undefined}
    {@const group = openGroup}
    <RelationList
      {nav}
      parent={featureId}
      {group}
      {locale}
      now={device.clock.now()}
      create={nav.offer(featureId, group)}
      {leads}
      oncreate={() => create(group)}
      onopen={(id) => goTo(id, undefined, featureId)}
    />
  {/if}
{/snippet}

{#if !warm}
  <!-- nothing yet: the sheet opens once its runs are loaded -->
{:else if model !== undefined}
  <FeatureSheet
    {open}
    {model}
    {locale}
    now={device.clock.now()}
    {onclose}
    onstart={(task) => void start(task)}
    {onopen}
    quickEdit={quick}
    onsave={() => void save()}
    {form}
    activity={timeline}
    {path}
    {notices}
    relation={openGroup === undefined ? undefined : level}
    createTasks={nav.createTasks(featureId)}
    {...onmention === undefined ? {} : { onmention: () => onmention(featureId) }}
  />
  {#if failed}<p
      role="alert"
      class={['fixed right-4 bottom-4 rounded-md bg-red-700 px-3 py-2 text-sm text-white', LAYER.menu]}
    >
      {message(locale, 'feature_task_failed')}
    </p>{/if}
{:else}
  <!-- The title says it once (WP-748); the body stays empty instead of repeating the sentence. -->
  <Sheet open={true} title={message(locale, 'feature_not_here')} {onclose}>{''}</Sheet>
{/if}
