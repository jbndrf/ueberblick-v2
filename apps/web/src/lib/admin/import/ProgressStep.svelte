<script lang="ts">
  // Step 4 'Fortschritt' (v3's progress bar '{n} von {m} importiert', `csv-import-dialog.svelte:462-468`, and its result
  // toast, `:253-258`). The server reports the progress (no client-side batching, R1); the result stays on screen with
  // its problems and a link back to the table.
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Progress } from '@ueberblick/ui/components/ui/progress';
  import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { T } from './i18n';
  import type { ImportFailure, JobView } from './import-client';
  import { problemKey } from './problems';

  let {
    t,
    job,
    failure = null,
    mode,
    onclose,
    doneKey = 'import_done_ok',
    failedKey = 'import_failed',
  }: {
    t: T;
    job: JobView | null;
    /** The start or the polling failed before the job could report. */
    failure?: ImportFailure | null;
    mode: 'atomic' | 'skip';
    onclose: () => void;
    /** The result lines of the wizard (CSV by default). */
    doneKey?: AdminKey;
    failedKey?: AdminKey;
  } = $props();

  const finished = $derived(failure !== null || job?.state === 'done' || job?.state === 'failed');
  const accepted = $derived(job?.state === 'done' && job.outcome === 'accepted');
  const skipped = $derived(job?.problem_count ?? job?.problems?.length ?? 0);
</script>

<div class="space-y-4 py-4" data-testid="import-progress">
  {#if !finished}
    <div class="space-y-3">
      <Progress value={job?.rows_done ?? 0} max={Math.max(job?.rows_total ?? 0, 1)} />
      <p class="text-center text-sm text-muted-foreground">
        {t('import_progress', { current: job?.rows_done ?? 0, total: job?.rows_total ?? 0 })}
      </p>
      {#if mode === 'atomic'}
        <p class="text-center text-xs text-muted-foreground">{t('import_progress_atomic')}</p>
      {/if}
    </div>
  {:else if failure}
    <p role="alert" class="flex items-center gap-2 text-sm text-destructive">
      <TriangleAlert class="size-4 shrink-0" />
      {t(failedKey)}
    </p>
  {:else if job?.state === 'failed'}
    <p role="alert" class="flex items-center gap-2 text-sm text-destructive">
      <TriangleAlert class="size-4 shrink-0" />
      {t(failedKey)}{job.error ? `: ${job.error}` : ''}
    </p>
  {:else if accepted}
    <p
      role="status"
      class="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"
      data-testid="import-result"
    >
      <CircleCheck class="size-4 shrink-0" />
      {t(doneKey, { count: job?.imported ?? 0 })}
    </p>
    {#if skipped > 0}
      <p class="text-sm text-muted-foreground">{t('import_done_skipped', { count: skipped })}</p>
    {/if}
  {:else}
    <p role="alert" class="flex items-center gap-2 text-sm text-destructive" data-testid="import-result">
      <TriangleAlert class="size-4 shrink-0" />
      {t('import_done_refused')}
    </p>
  {/if}

  {#if finished && job && (job.problems?.length ?? 0) > 0}
    <ul class="max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-3 text-xs">
      {#each job.problems ?? [] as p, i (i)}
        {@const key = problemKey(p.code)}
        <li>
          <span class="font-medium"
            >{p.row > 0 ? t('import_problem_row', { row: p.row }) : t('import_problem_file')}:</span
          >
          {key ? t(key) : p.message}{key && p.message ? ` (${p.message})` : ''}
        </li>
      {/each}
    </ul>
    {#if (job.problem_count ?? 0) > (job.problems?.length ?? 0)}
      <p class="text-xs text-muted-foreground">
        {t('import_problems_more', { count: (job.problem_count ?? 0) - (job.problems?.length ?? 0) })}
      </p>
    {/if}
  {/if}
</div>
<Dialog.Footer>
  {#if finished}
    <Button onclick={onclose} data-testid="import-table"
      >{accepted ? t('import_open_table') : t('import_close')}</Button
    >
  {/if}
</Dialog.Footer>
