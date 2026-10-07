<script lang="ts">
  // v3's Aktivität timeline (Module:1314-1502): the runs of an Objekt grouped by stage visit, newest first. A stage
  // move is a tappable header (it jumps to Daten), "Erstellt" is the green genesis header, a run is one line with a
  // smart label that expands to the changed values. Built from the runs on the device (`buildActivity`).
  import type { Instant } from '@ueberblick/core/model';
  import type { ActivityLabel, ActivityRun, ActivitySegment, ActivityView } from '@ueberblick/ui';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { message, type Locale } from '../../messages';
  import ActivityFields from './ActivityFields.svelte';
  import RunStatus from './RunStatus.svelte';
  import { activityLabelText } from './label';
  import { when } from './when';

  interface Props {
    view: ActivityView;
    locale: Locale;
    /** The clock port's reading. */
    now: Instant;
    /** v3's `navigateToData`: a stage header takes the user to the Daten tab. */
    onshowdata?: () => void;
  }
  let { view, locale, now, onshowdata }: Props = $props();

  const labelText = (label: ActivityLabel, task: string): string => activityLabelText(label, task, locale);
  const stage = (s: ActivitySegment): string => {
    const name = s.stageLabel ?? '';
    return s.visitTotal > 1 ? `${name} (${s.visitIndex}/${s.visitTotal})` : name;
  };
  const expandable = (run: ActivityRun): boolean => run.fields.length > 0 || run.touchedGeometry;
  const neutral = (): string => message(locale, 'activity_unknown_actor');
</script>

{#if view.segments.length === 0}
  <div class="py-12 text-center text-muted-foreground">
    <p class="text-sm">{message(locale, 'feature_no_activity')}</p>
  </div>
{:else}
  <div class="space-y-1">
    {#snippet creationHeader(s: ActivitySegment, index: number)}
      {@const run = s.creation}
      {@const open = run !== undefined && expandable(run)}
      <details class="group" data-testid="activity-entry" class:mt-2={index > 0}>
        <summary
          class="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 transition-colors select-none hover:bg-green-100 dark:border-green-800 dark:bg-green-950/50 dark:hover:bg-green-900/50"
          class:pointer-events-none={!open}
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-green-900 dark:text-green-100">
              {message(locale, 'activity_created')}
              {#if run}<RunStatus status={run.status} {locale} class="ml-1" />{/if}
            </p>
            <p class="text-xs text-green-700 dark:text-green-300">
              {stage(s)}{s.stageLabel === undefined ? '' : ' · '}{when(
                run?.at ?? s.created?.at ?? now,
                now,
                locale,
              )} · {run?.actorLabel ?? s.created?.by ?? neutral()}
            </p>
          </div>
          {#if open}<ChevronRight class="h-4 w-4 shrink-0 text-green-500" />{/if}
        </summary>
        {#if run && open}<ActivityFields {run} {locale} />{/if}
      </details>
    {/snippet}

    {#each view.segments as s, index (s.key)}
      {#if s.transition}
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-left transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:hover:bg-blue-900/50"
          class:mt-2={index > 0}
          data-testid="activity-stage"
          onclick={() => onshowdata?.()}
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-blue-900 dark:text-blue-100">
              {message(locale, 'activity_moved_to', { stage: stage(s) })}
              <RunStatus status={s.transition.status} {locale} class="ml-1" />
            </p>
            <p class="text-xs text-blue-700 dark:text-blue-300">
              {when(s.transition.at, now, locale)} · {s.transition.by}
            </p>
          </div>
          <ChevronRight class="h-4 w-4 shrink-0 text-blue-400" />
        </button>
      {:else if s.creation || s.created}
        {@render creationHeader(s, index)}
      {:else if s.stageLabel !== undefined}
        <div class="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2" class:mt-2={index > 0}>
          <div class="h-2 w-2 shrink-0 rounded-full bg-green-500"></div>
          <p class="text-sm font-semibold text-foreground">{stage(s)}</p>
        </div>
      {/if}

      {#if s.entries.length > 0}
        <div class="ml-3 space-y-0.5 border-l-2 border-border pl-3">
          {#each s.entries as run (run.runId)}
            <details class="group" data-testid="activity-entry">
              <summary
                class="-mx-1 flex cursor-pointer items-baseline justify-between gap-2 rounded px-1 py-1.5 select-none hover:bg-muted/30"
                class:pointer-events-none={!expandable(run)}
              >
                <div class="flex min-w-0 items-baseline gap-1.5">
                  <span class="text-sm font-medium text-foreground">{labelText(run.label, run.task)}</span>
                  <span class="shrink-0 truncate text-[11px] text-muted-foreground">
                    {run.task} · {run.actorLabel}
                  </span>
                  <RunStatus status={run.status} {locale} />
                </div>
                <span class="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
                  {when(run.at, now, locale)}
                </span>
              </summary>
              {#if expandable(run)}<ActivityFields {run} {locale} />{/if}
            </details>
          {/each}
        </div>
      {/if}
    {/each}
  </div>
{/if}
