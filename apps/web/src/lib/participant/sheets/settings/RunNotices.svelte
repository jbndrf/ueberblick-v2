<script lang="ts">
  // The run notices at an Objekt (v3 `TaskRunNotices.svelte`): a run the device just refused (nothing was queued),
  // runs the server refused (send again / discard), and how many runs still wait to upload. Each refused run jumps to
  // its Objekt (owner 10.23). The feature sheet (WP-623) mounts this with the rows of its Objekt; the data is props.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { FeatureId } from '@ueberblick/core/model';
  import { message, type Locale } from '../../messages';
  import type { QueueRow } from './queue-rows';
  import { openCount, refusedRows } from './queue-rows';

  interface Props {
    rows: readonly QueueRow[];
    locale: Locale;
    /** Only notices about this Objekt; all runs when absent. */
    featureId?: FeatureId;
    /** A transient failure is being retried. */
    retrying?: boolean;
    /** What the device refused just now, as text. */
    localRefusal?: string | undefined;
    onjump?: (featureId: FeatureId) => void;
    onresend: (runId: string) => void;
    ondiscard: (runId: string) => void;
    ondismisslocal?: () => void;
  }
  let {
    rows,
    locale,
    featureId,
    retrying = false,
    localRefusal,
    onjump,
    onresend,
    ondiscard,
    ondismisslocal,
  }: Props = $props();

  const refused = $derived(refusedRows(rows, featureId));
  const waiting = $derived(
    openCount(featureId === undefined ? rows : rows.filter((r) => r.featureId === featureId)),
  );
</script>

{#if localRefusal !== undefined}
  <div
    class="mb-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
    data-testid="run-local-refusal"
    role="alert"
  >
    <div class="min-w-0 flex-1 text-sm">
      <p class="font-semibold">{message(locale, 'run_local_refused_title')}</p>
      <p>{localRefusal}</p>
    </div>
    {#if ondismisslocal}
      <Button variant="ghost" size="sm" onclick={ondismisslocal}>{message(locale, 'run_dismiss')}</Button>
    {/if}
  </div>
{/if}

{#if refused.length > 0}
  <div
    class="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    data-testid="run-refused"
  >
    <p class="mb-2 text-sm font-semibold">{message(locale, 'run_refused_title')}</p>
    <ul class="space-y-2">
      {#each refused as row (row.runId)}
        <li class="text-sm" data-run={row.runId}>
          {#if row.featureId !== undefined && onjump}
            {@const id = row.featureId}
            <button
              type="button"
              class="min-h-11 text-left font-medium underline-offset-2 hover:underline"
              aria-label={message(locale, 'run_jump', { task: row.task })}
              onclick={() => onjump(id)}
            >
              {row.task}
            </button>
          {:else}
            <p class="font-medium">{row.task}</p>
          {/if}
          {#if row.reason !== undefined}<p class="text-xs">{row.reason}</p>{/if}
          <div class="mt-1 flex gap-2">
            {#if row.canResend}
              <Button variant="outline" size="sm" onclick={() => onresend(row.runId)}>
                {message(locale, 'run_resend')}
              </Button>
            {/if}
            <Button variant="ghost" size="sm" onclick={() => ondiscard(row.runId)}>
              {message(locale, 'run_discard')}
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}

{#if waiting > 0}
  <div class="mb-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground" data-testid="run-pending">
    {message(locale, 'run_pending_notice', { count: waiting })}{retrying
      ? ` ${message(locale, 'run_retry_notice')}`
      : ''}
  </div>
{/if}
