<script lang="ts">
  // v3's TaskRunNotices at the top of the feature sheet: the runs of this Objekt that the server refused (with
  // "Erneut senden" and "Verwerfen") and how many still wait to be sent. The rows are the device queue's (`queueRows`,
  // the same list Einstellungen shows); the buttons call the queue's own `resubmit` and `discard` (WP-627), so there is
  // one path for a refused or waiting run (R1, R3). A refusal the device itself made is a stored refused run as well.
  import { onMount, untrack } from 'svelte';
  import type { FeatureId, RunId } from '@ueberblick/core/model';
  import { message, type Locale } from '../../messages';
  import RunNotices from '../../sheets/settings/RunNotices.svelte';
  import { queueRows, type QueueRow } from '../../sheets/settings/queue-rows';
  import type { NoticesDevice } from './device';

  interface Props {
    device: NoticesDevice;
    featureId: FeatureId;
    locale: Locale;
    taskLabel: (taskKey: string) => string;
    /** The label of a task's field, for the "Feld: …" line of a refusal. */
    fieldLabel?: (taskKey: string, fieldKey: string) => string | undefined;
  }
  let { device, featureId, locale, taskLabel, fieldLabel }: Props = $props();

  let rows: readonly QueueRow[] = $state([]);
  let retrying = $state(false);
  let failed = $state(false);

  let load = 0;
  async function reload(): Promise<void> {
    const mine = ++load;
    const runs = await device.store.readRuns();
    if (mine !== load) return;
    const status = device.queue.status();
    rows = queueRows(
      runs.filter((r) => r.run.featureId === featureId),
      status,
      taskLabel,
      locale,
      fieldLabel,
    );
    retrying = status.retryInMs !== undefined;
  }

  onMount(() => device.queue.subscribe(() => void reload()));
  // Only this Objekt's runs are read, again when the sheet moves to another Objekt.
  $effect(() => {
    void featureId;
    void untrack(reload);
  });

  const act = (op: () => Promise<unknown>) => async (): Promise<void> => {
    failed = false;
    try {
      await op();
    } catch {
      failed = true;
    }
    await reload();
  };
</script>

<RunNotices
  {rows}
  {locale}
  {featureId}
  {retrying}
  onresend={(id) => void act(() => device.queue.resubmit(id as RunId))()}
  ondiscard={(id) => void act(() => device.queue.discard(id as RunId))()}
/>
{#if failed}
  <p role="alert" class="mb-3 text-xs text-destructive" data-testid="run-notice-failed">
    {message(locale, 'feature_task_failed')}
  </p>
{/if}
