<script lang="ts">
  // The create form on its own (a creating task from Werkzeuge, no feature open) in v3's one detail shell (`ModuleShell`: 35/90 vh on a phone, the 450 px panel
  // from 768 px), titled with the Objektart (v3 `title={pw.workflow.name}`, +page.svelte:2753; the detail module titles
  // a running task with the instance's workflow name). The dialog is named by the task. The sticky footer is the
  // form's own (`FormRenderer`). Closing slides the shell out and unmounts it when the slide is over.
  import { onDestroy } from 'svelte';
  import { ModuleShell, resolveLabel } from '@ueberblick/ui';
  import type { FeatureId } from '@ueberblick/core/model';
  import type { Json, LocationPicker } from '@ueberblick/ui';
  import type { Device } from '../device';
  import { message, type Locale } from '../messages';
  import { taskTypeOf } from '../tools';
  import FormSheet from './FormSheet.svelte';
  import { slideOut } from './slide-out.svelte';

  interface Props {
    device: Device;
    taskKey: string;
    featureIds: readonly FeatureId[];
    locale: Locale;
    online: boolean;
    center: () => readonly [number, number] | undefined;
    pickLocation?: LocationPicker;
    /** What the form opens filled with (the pin of the + flow), by property. */
    initial?: Readonly<Record<string, Json>>;
    /** A create run was accepted: the id of the feature it made, before the shell slides out (WP-680). */
    oncreated?: (id: FeatureId) => void;
    /** False hides the shell while the map is in use (a location step), without unmounting it: the steps keep their values. */
    shown?: boolean;
    /** The shell is gone (after the slide-out): the host drops it. */
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
    shown = true,
    onclose,
  }: Props = $props();

  const out = slideOut(() => onclose());
  const leave = (): void => out.close();
  onDestroy(() => out.cancel());

  const file = $derived(device.config.file);
  const taskLabel = $derived(resolveLabel(file.tasks?.[taskKey]?.label, locale, taskKey));
  // The Objektart: of the feature the task runs on, else the one the task creates.
  const typeLabel = $derived.by(() => {
    const id = featureIds[0];
    const key = (id === undefined ? undefined : device.feature(id)?.type) ?? taskTypeOf(file, taskKey);
    return key === undefined ? taskLabel : resolveLabel(file.types?.[key]?.label, locale, key);
  });

  // A form needs room: it opens full height on a phone (v3 shares the detail's height, which people expand first).
  let expanded = $state(true);
</script>

<ModuleShell
  open={shown && !out.leaving}
  bind:expanded
  title={typeLabel}
  label={taskLabel}
  toggleLabel={message(locale, 'feature_toggle')}
  closeLabel={message(locale, 'feature_close')}
  onclose={leave}
  testid="form-shell"
>
  <FormSheet
    {device}
    {taskKey}
    {featureIds}
    {locale}
    {online}
    {center}
    {...pickLocation === undefined ? {} : { pickLocation }}
    {...initial === undefined ? {} : { initial }}
    {...oncreated === undefined ? {} : { oncreated }}
    onclose={leave}
  />
</ModuleShell>
