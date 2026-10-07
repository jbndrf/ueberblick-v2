<script lang="ts">
  // The Aktivität tab (v3 `instances/[id]/+page.svelte:392-480`): the runs of an Objekt grouped by stage visit,
  // newest first. A visit is a heading ("Stufe (2/3)"), a run one line (a smart label, "Aufgabe · Name", the time) that
  // opens to the values it wrote; the creating run is the green line. The grouping is the participant sheet's
  // (`buildActivity`); refused runs, which v4 keeps, show their badge and reason.
  import type { ActivityLabel, ActivityRun, ActivitySegment, ActivityView } from '@ueberblick/ui';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Spinner } from '@ueberblick/ui/components/ui/spinner';
  import FileCell from '../data/FileCell.svelte';
  import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';

  let {
    view,
    refusals,
    lifecycles,
    project,
    locale,
    t,
    lifecycleName,
    protokollHref,
    transitionRun,
    hasMore,
    loadingMore,
    onMore,
    onImage,
  }: {
    view: ActivityView;
    refusals: ReadonlyMap<string, string>;
    lifecycles: ReadonlyMap<string, string>;
    project: string;
    locale: string;
    t: (key: AdminKey, values?: Record<string, string | number>) => string;
    lifecycleName: (state: string) => string;
    /** The Protokoll page of a run (WP-372). */
    protokollHref: (runId: string) => string;
    /** The accepted run of a stage change, by its time: a run that only moved the stage is the heading's line, not an entry. */
    transitionRun: (at: string) => string | undefined;
    hasMore: boolean;
    loadingMore: boolean;
    onMore: () => void;
    onImage: (url: string, name: string) => void;
  } = $props();

  const stamp = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale);
  };
  const labelText = (label: ActivityLabel, task: string): string => {
    switch (label.kind) {
      case 'created':
        return t('feature_activity_created');
      case 'location':
        return t('feature_activity_location_updated');
      case 'field':
        return t('feature_activity_field_updated', { label: label.label });
      case 'fields':
        return t('feature_activity_fields_updated', { count: label.count });
      default:
        return task;
    }
  };
  const heading = (s: ActivitySegment): string =>
    s.visitTotal > 1 ? `${s.stageLabel ?? ''} (${s.visitIndex}/${s.visitTotal})` : (s.stageLabel ?? '');
  const expandable = (run: ActivityRun): boolean =>
    run.fields.length > 0 || run.touchedGeometry || lifecycles.has(run.runId) || refusals.has(run.runId);
</script>

{#snippet entry(run: ActivityRun, creation: boolean)}
  <li
    class="p-3 text-sm"
    class:bg-green-50={creation}
    class:dark:bg-green-950={creation}
    data-testid="activity-entry"
  >
    <details class="group">
      <summary
        class="flex cursor-pointer items-center justify-between gap-4 select-none"
        class:pointer-events-none={!expandable(run)}
      >
        <div class="flex min-w-0 flex-col">
          <span
            class="font-medium"
            class:text-base={creation}
            class:text-green-900={creation}
            class:dark:text-green-100={creation}
          >
            {labelText(run.label, run.task)}
            {#if run.status === 'refused'}
              <Badge variant="outline" class="ml-1 text-[10px]" data-testid="activity-refused">
                {t('feature_activity_refused')}
              </Badge>
            {/if}
          </span>
          <span class="truncate text-xs text-muted-foreground">{run.task} · {run.actorLabel}</span>
        </div>
        <span class="shrink-0 text-xs text-muted-foreground">{stamp(run.at)}</span>
      </summary>
      {#if expandable(run)}
        <dl class="mt-2 space-y-1 border-l-2 border-border pl-3" data-testid="activity-detail">
          {#if refusals.has(run.runId)}
            <div class="text-xs text-destructive" data-testid="activity-refusal">
              {refusals.get(run.runId)}
            </div>
          {/if}
          {#if lifecycles.has(run.runId)}
            <div class="flex justify-between gap-4 text-xs">
              <dt class="text-muted-foreground">{t('feature_header_status')}</dt>
              <dd class="text-right font-medium">{lifecycleName(lifecycles.get(run.runId) ?? '')}</dd>
            </div>
          {/if}
          {#if run.touchedGeometry}
            <div class="flex justify-between gap-4 text-xs">
              <dt class="text-muted-foreground">{t('feature_location')}</dt>
              <dd class="text-right font-medium">{t('feature_activity_location_updated')}</dd>
            </div>
          {/if}
          {#each run.fields as field (field.key)}
            <div class="flex justify-between gap-4 text-xs">
              <dt class="text-muted-foreground">{field.label}</dt>
              <dd class="min-w-0 text-right font-medium break-words">
                {#if field.files.length > 0}
                  <div class="flex justify-end"><FileCell {project} value={field.files} {onImage} /></div>
                {:else}
                  {field.empty ? t('feature_no_value') : field.text}
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      {/if}
    </details>
    {#if run.status === 'accepted'}
      <a
        href={protokollHref(run.runId)}
        class="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
        data-testid="activity-protokoll"
      >
        {t('feature_activity_protokoll_open')}
      </a>
    {/if}
  </li>
{/snippet}

{#if view.segments.length === 0}
  <p class="py-8 text-center text-sm text-muted-foreground" data-testid="feature-activity-empty">
    {t('feature_activity_empty')}
  </p>
{:else}
  <div class="space-y-5" data-testid="feature-activity">
    {#each view.segments as segment (segment.key)}
      <section class="space-y-2" data-testid="activity-segment">
        {#if segment.stageLabel !== undefined}
          <div>
            <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {heading(segment)}
            </h3>
            {#if segment.transition}
              <p class="text-xs text-muted-foreground">
                {stamp(segment.transition.at)} · {segment.transition.by}
                {#if transitionRun(segment.transition.at) !== undefined}
                  ·
                  <a
                    href={protokollHref(transitionRun(segment.transition.at) ?? '')}
                    class="font-medium text-primary underline-offset-2 hover:underline"
                    data-testid="activity-protokoll"
                  >
                    {t('feature_activity_protokoll_open')}
                  </a>
                {/if}
              </p>
            {/if}
          </div>
        {/if}
        {#if segment.entries.length > 0 || segment.creation || segment.created}
          <ul class="divide-y divide-border rounded-lg border border-border">
            {#each segment.entries as run (run.runId)}
              {@render entry(run, false)}
            {/each}
            {#if segment.creation}
              {@render entry(segment.creation, true)}
            {:else if segment.created}
              <li class="bg-green-50 p-3 text-sm dark:bg-green-950" data-testid="activity-entry">
                <div class="flex items-center justify-between gap-4">
                  <div class="flex min-w-0 flex-col">
                    <span class="text-base font-medium text-green-900 dark:text-green-100">
                      {t('feature_activity_created')}
                    </span>
                    {#if segment.created.by}
                      <span class="truncate text-xs text-muted-foreground">{segment.created.by}</span>
                    {/if}
                  </div>
                  <span class="shrink-0 text-xs text-muted-foreground">{stamp(segment.created.at)}</span>
                </div>
              </li>
            {/if}
          </ul>
        {/if}
      </section>
    {/each}
    {#if hasMore}
      <div class="flex justify-center">
        <Button
          variant="outline"
          size="sm"
          onclick={onMore}
          disabled={loadingMore}
          data-testid="activity-more"
        >
          {#if loadingMore}<Spinner class="mr-2" />{/if}
          {t('feature_activity_more')}
        </Button>
      </div>
    {/if}
  </div>
{/if}
