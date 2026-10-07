<script lang="ts">
  // Every run still on the device (v3 `TaskRunQueueList.svelte`): waiting and uploading runs, and refused ones with
  // "Erneut senden" / "Verwerfen". New (owner 10.23): the row's title jumps to the Objekt on the map.
  // A waiting run can be dropped too (v3 `discardTaskRun`, no confirmation); the one being sent cannot until it settles.
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { FeatureId } from '@ueberblick/core/model';
  import { message, type Locale } from '../../messages';
  import type { QueueRow } from './queue-rows';

  interface Props {
    rows: readonly QueueRow[];
    locale: Locale;
    onjump: (featureId: FeatureId) => void;
    onresend: (runId: string) => void;
    ondiscard: (runId: string) => void;
  }
  let { rows, locale, onjump, onresend, ondiscard }: Props = $props();
</script>

{#if rows.length > 0}
  <div class="mt-3" data-testid="run-queue">
    <p class="mb-1 text-xs font-medium text-muted-foreground">{message(locale, 'settings_queue_title')}</p>
    <ul class="space-y-2">
      {#each rows as row (row.runId)}
        <li class="rounded-md border bg-background p-2 text-xs" data-run={row.runId}>
          <div class="flex items-center justify-between gap-2">
            {#if row.featureId !== undefined && row.canJump}
              {@const id = row.featureId}
              <button
                type="button"
                class="min-h-11 truncate text-left font-medium underline-offset-2 hover:underline focus-visible:outline-2"
                aria-label={message(locale, 'run_jump', { task: row.task })}
                onclick={() => onjump(id)}
              >
                {row.task}
              </button>
            {:else}
              <span class="truncate font-medium">{row.task}</span>
            {/if}
            <Badge
              variant={row.state === 'refused' || row.dependent ? 'destructive' : 'outline'}
              class="shrink-0"
            >
              {row.stateText}
            </Badge>
          </div>
          {#if row.reason !== undefined}<p class="mt-1 text-muted-foreground">{row.reason}</p>{/if}
          {#if row.canResend || row.canDiscard}
            <div class="mt-1 flex gap-2">
              {#if row.canResend}
                <Button variant="outline" size="sm" onclick={() => onresend(row.runId)}>
                  {message(locale, 'run_resend')}
                </Button>
              {/if}
              {#if row.canDiscard}
                <Button variant="ghost" size="sm" onclick={() => ondiscard(row.runId)}>
                  {message(locale, 'run_discard')}
                </Button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
