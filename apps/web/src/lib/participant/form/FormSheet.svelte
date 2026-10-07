<script lang="ts">
  // One task in the form sheet: the form model from the project file, the tool host for this task's fields, and the
  // ports of the device (run queue as submitter, drafts). A task with a single form is the task sheet (`TaskSheet`);
  // a task with several steps (WP-616: form, quick edit, location) is the multi-step flow, "Schritt n von m", which
  // submits once at the end. The location step opens the map through `pickLocation` (the map's drawing mode).
  import { onDestroy, untrack, type ComponentProps } from 'svelte';
  import type { FeatureId, Key, RunId } from '@ueberblick/core/model';
  import { stepsOf } from '@ueberblick/core/form';
  import {
    buildFormModel,
    buildStepViews,
    resolveLabel,
    StepFlow,
    TaskSheet,
    ToolMount,
  } from '@ueberblick/ui';
  import type { StepConfirm } from '@ueberblick/ui';
  import { submitConfirm } from '../feature/task-presentation';
  import type { Json, LocationPicker, ToolSlot } from '@ueberblick/ui';
  import type { Device } from '../device';
  import { message, type Locale } from '../messages';
  import { taskTypeOf } from '../tools';
  import { choicesFor } from './choices';
  import { closeOnResult } from './close-on-result';
  import { localRefusal } from './local-refusal';
  import RunNotices from '../sheets/settings/RunNotices.svelte';
  import { createsOffMap, createsOnMap, mintNewFeatureId, reportCreated } from './new-feature';
  import FieldTool from './FieldTool.svelte';
  import { fieldToolHost } from './field-tools';
  import { stepLabels } from './step-labels';
  import { taskBinds } from './binds';

  interface Props {
    device: Device;
    taskKey: string;
    featureIds: readonly FeatureId[];
    locale: Locale;
    online: boolean;
    center: () => readonly [number, number] | undefined;
    /** Opens the map's drawing mode for a location step (WP-635); without it the step says the map is not available. */
    pickLocation?: LocationPicker;
    /** What the form opens filled with: the position the + flow placed (WP-652), by property. */
    initial?: Readonly<Record<string, Json>>;
    /** The create run was accepted (or stored offline): the id of the feature it made, just before `onclose` (WP-680). */
    oncreated?: (id: FeatureId) => void;
    onclose: () => void;
  }
  let {
    device,
    taskKey,
    featureIds,
    locale,
    online,
    center,
    pickLocation,
    initial,
    oncreated,
    onclose,
  }: Props = $props();

  // A creation with a position of its own keeps its draft apart from an old draft of the task, which would hide the pin.
  const draftKey = $derived(
    initial === undefined ? undefined : [taskKey, 'new', JSON.stringify(initial)].join(':'),
  );

  const file = $derived(device.config.file);
  const task = $derived(file.tasks?.[taskKey]);
  const type = $derived(taskTypeOf(file, taskKey));
  const properties = $derived(type === undefined ? {} : (file.types?.[type]?.properties ?? {}));
  const steps = $derived(task === undefined ? [] : stepsOf(task));
  const multi = $derived(steps.length > 1 || steps.some((s) => s.kind !== 'form'));

  // A create on the map gets its feature id before the run is submitted (WP-680); any other create (`on: $none`) is
  // told by the run queue once the run is planned (WP-681). Either way the form can open the new feature.
  // svelte-ignore state_referenced_locally: the task and the device are fixed for the life of the sheet
  const minted = reportCreated(
    mintNewFeatureId(
      device.submitter,
      device.ids,
      oncreated !== undefined && createsOnMap(device.config.file, taskKey),
    ),
    (runId) => device.queue.createdBy(runId),
    oncreated !== undefined && createsOffMap(device.config.file, taskKey),
  );
  /** The form is over: tell the host which feature it made (create path only), then close. */
  const done = (): void => {
    const id = minted.created();
    if (id !== undefined) oncreated?.(id);
    onclose();
  };

  // The form closes once its runs are stored on the device, online or offline, as v3 does: `closeOnResult`.
  // svelte-ignore state_referenced_locally: the task and the device are fixed for the life of the sheet
  // v3's red "Nicht möglich" box (`TaskRunNotices`) for a run the device refuses at once; the form stays open (`localRefusal`).
  let refusalText: string | undefined = $state();
  const submitter = closeOnResult(
    localRefusal(minted, {
      discard: (id) => device.queue.discard(id as RunId),
      onrefused: (reason) => (refusalText = reason),
      onstored: () => (refusalText = undefined),
    }),
    { onclose: done },
  );
  onDestroy(() => submitter.dispose());

  // The bind variables of the task and the Objektarten of its bind fields (A5): a missing Objekt hides its fields.
  const binds = $derived(
    taskBinds(
      device.config,
      taskKey,
      device.reader.taskContext(featureIds[0]),
      device.reader.taskBinds(taskKey as Key, featureIds[0]),
    ),
  );
  const model = $derived(
    task?.form === undefined || type === undefined
      ? undefined
      : buildFormModel({
          form: task.form,
          properties,
          bound: binds.bound,
          ...(initial === undefined ? {} : { placed: initial }),
        }),
  );
  // The views of the steps, opened on the values of the feature now (a quick edit starts from them).
  // The sessions open once per task, not per language: a language switch re-labels them (`setLocale`) and keeps what
  // was typed (WP-790). `locale` is read untracked here for that reason.
  const subjectId = $derived(featureIds[0]);
  const built = $derived.by(() => {
    if (task === undefined || !multi) return [];
    const subject = subjectId === undefined ? undefined : device.feature(subjectId);
    return buildStepViews({
      task: taskKey as Key,
      def: task,
      properties,
      config: device.config,
      ctx: binds.ctx,
      bound: binds.bound,
      ...(type === undefined ? {} : { type }),
      locale: untrack(() => locale),
      current: { ...((subject?.properties ?? {}) as Readonly<Record<string, Json>>), ...initial },
      ...(initial === undefined ? {} : { initial }),
    });
  });
  $effect(() => {
    for (const v of built) if (v.kind !== 'location') v.session.setLocale(locale);
  });
  // A location step names its property in the language now.
  const views = $derived(
    built.map((v) =>
      v.kind === 'location'
        ? { ...v, label: resolveLabel(properties[v.property]?.label, locale, v.property) }
        : v,
    ),
  );
  const fields = $derived(
    multi
      ? views.flatMap((v) => (v.kind === 'location' ? [] : v.session.model.fields))
      : (model?.fields ?? []),
  );
  const choices = $derived(choicesFor(device, type, fields, locale));
  const host = $derived(fieldToolHost(device, type, locale, center));
  // The task's `confirm` of a multi-step task is asked when its last step is sent (WP-730, B-023).
  const confirm: StepConfirm | undefined = $derived.by(() => {
    const text = submitConfirm(file, taskKey as Key, locale);
    if (text === undefined || task === undefined) return undefined;
    return {
      title: resolveLabel(task.button?.label ?? task.label, locale, taskKey),
      text,
      cancel: message(locale, 'feature_confirm_cancel'),
      go: message(locale, 'feature_confirm_go'),
    };
  });
  /** What a tool of the single-page task sheet is handed (the sheet does not export the type). */
  type TaskToolSlot = Parameters<NonNullable<ComponentProps<typeof TaskSheet>['tool']>>[0];
</script>

{#if refusalText !== undefined}
  <div class="px-4 pt-2">
    <RunNotices
      rows={[]}
      {locale}
      localRefusal={refusalText}
      onresend={() => undefined}
      ondiscard={() => undefined}
      ondismisslocal={() => (refusalText = undefined)}
    />
  </div>
{/if}
{#if task === undefined || (!multi && model === undefined)}
  <p role="alert">{message(locale, 'task_unknown')}</p>
{:else if multi}
  {#snippet stepTool(slot: ToolSlot)}
    <FieldTool {...{ host, locale, slot }} />
  {/snippet}
  <StepFlow
    taskKey={taskKey as Key}
    steps={views}
    labels={stepLabels(locale)}
    ids={device.ids}
    {submitter}
    {featureIds}
    {online}
    {choices}
    tool={stepTool}
    {...confirm === undefined ? {} : { confirm }}
    {...pickLocation === undefined ? {} : { pickLocation }}
    {onclose}
  />
{:else if model !== undefined}
  {#snippet tool(slot: TaskToolSlot)}
    <!-- `slot` is a reserved attribute name on a component, so the props go in as one object -->
    <ToolMount {...{ host, locale, slot: { ...slot, set: slot.produce } }} />
  {/snippet}
  <TaskSheet
    taskKey={taskKey as Key}
    {model}
    config={device.config}
    ctx={binds.ctx}
    {...type === undefined ? {} : { type }}
    {...initial === undefined || draftKey === undefined ? {} : { initial, draftKey }}
    ids={device.ids}
    {submitter}
    drafts={device.drafts}
    {featureIds}
    {locale}
    {online}
    {choices}
    {tool}
    {onclose}
  />
{/if}
