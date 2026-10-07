<script lang="ts">
  // Step 3 'Vorschau' (v3's 'confirm' step, `csv-import-dialog.svelte:469-535`): '{n} Zeilen bereit', the first rows as a
  // table, 'und {n} weitere Zeilen', the 'Alle vorhandenen Daten ersetzen' checkbox. The rows and the problem list are the
  // dry run's (R1); the mode choice (register row 87) and the replace warning (owner Q19) are engine-given. A project
  // that was never published has no dry run: it explains the import after 'Veröffentlichen' (owner A4).
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import type { T } from './i18n';
  import type { ImportFailure, PlanResult } from './import-client';
  import { formatValue, previewColumns, problemKey } from './problems';

  let {
    t,
    plan,
    published,
    rowCount,
    labels,
    replace = $bindable(),
    mode = $bindable(),
    busy = false,
    failure = null,
    onback,
    onimport,
  }: {
    t: T;
    /** The dry run; null when the project has none yet (never published). */
    plan: PlanResult | null;
    published: boolean;
    /** Data rows of the file, for '... und n weitere Zeilen'. */
    rowCount: number;
    /** Property key to label, for the preview's column heads. */
    labels: Readonly<Record<string, string>>;
    replace: boolean;
    mode: 'atomic' | 'skip';
    /** Publishing or starting. */
    busy?: boolean;
    /** Why 'Veröffentlichen und importieren' stopped: a text and, if the admin can fix it, where. */
    failure?: { readonly text: string; readonly href?: string; readonly hrefLabel?: string } | null;
    onback: () => void;
    onimport: () => void;
  } = $props();

  const ok = $derived(plan !== null && plan.kind === 'ok' ? plan : null);
  const failed: ImportFailure | null = $derived(plan !== null && plan.kind === 'error' ? plan : null);
  const columns = $derived(ok ? previewColumns(ok.preview, labels) : []);
  const blocked = $derived(
    published && (ok === null || ok.counts.valid === 0 || (mode === 'atomic' && ok.counts.problem_rows > 0)),
  );
  const effectiveMode = $derived(replace ? 'atomic' : mode);
  const errorText = (code: string): string =>
    code === 'file_too_large'
      ? t('import_error_file_too_large')
      : code === 'network'
        ? t('import_error_network')
        : code === 'replace_needs_atomic'
          ? t('import_error_replace_needs_atomic')
          : t('import_error_other');
</script>

<div class="space-y-4 py-4">
  {#if failed}
    <p role="alert" class="text-sm text-destructive">{errorText(failed.code)}</p>
  {:else if ok}
    <p class="text-sm" data-testid="import-ready">{t('import_ready', { count: ok.counts.valid })}</p>

    {#if ok.preview.length > 0}
      <div class="overflow-x-auto rounded-md border">
        <table class="text-xs" data-testid="import-preview">
          <thead>
            <tr class="border-b bg-muted/50">
              {#each columns as c (c.key)}
                <th class="p-2 text-left font-medium whitespace-nowrap">{c.label}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each ok.preview as row (row.row)}
              <tr class="border-b last:border-0">
                {#each columns as c (c.key)}
                  <td class="max-w-[150px] truncate p-2 whitespace-nowrap"
                    >{formatValue(row.values[c.key], t('import_yes'), t('import_no'))}</td
                  >
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if rowCount > ok.preview.length}
        <p class="text-xs text-muted-foreground">
          {t('import_more_rows', { count: rowCount - ok.preview.length })}
        </p>
      {/if}
    {/if}

    {#if ok.counts.problems > 0}
      <div
        class="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
        data-testid="import-problems"
      >
        <p class="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
          <TriangleAlert class="size-4 shrink-0" />
          {t('import_problem_rows', { count: ok.counts.problem_rows })}
        </p>
        <ul class="max-h-40 space-y-0.5 overflow-y-auto text-xs text-amber-900 dark:text-amber-200">
          {#each ok.problems as p, i (i)}
            {@const key = problemKey(p.code)}
            <li>
              <span class="font-medium"
                >{p.row > 0 ? t('import_problem_row', { row: p.row }) : t('import_problem_file')}:</span
              >
              {key ? t(key) : p.message}{key && p.message ? ` (${p.message})` : ''}
            </li>
          {/each}
        </ul>
        {#if ok.counts.problems > ok.problems.length}
          <p class="text-xs text-amber-900 dark:text-amber-200">
            {t('import_problems_more', { count: ok.counts.problems - ok.problems.length })}
          </p>
        {/if}
      </div>
    {/if}
    <p class="text-xs text-muted-foreground">{t('import_rules_note')}</p>
  {:else if !published}
    <div
      class="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
      data-testid="import-unpublished"
    >
      <p class="text-sm font-medium text-amber-800 dark:text-amber-300">{t('import_unpublished_title')}</p>
      <p class="text-xs text-amber-900 dark:text-amber-200">{t('import_unpublished_body')}</p>
    </div>
  {/if}

  <fieldset class="space-y-2" disabled={busy}>
    <legend class="text-sm font-medium">{t('import_mode_title')}</legend>
    <label class="flex items-start gap-2 text-sm">
      <input
        type="radio"
        name="import-mode"
        class="mt-1"
        value="atomic"
        checked={effectiveMode === 'atomic'}
        onchange={() => (mode = 'atomic')}
      />
      <span>{t('import_mode_atomic')}</span>
    </label>
    <label class="flex items-start gap-2 text-sm" class:opacity-50={replace}>
      <input
        type="radio"
        name="import-mode"
        class="mt-1"
        value="skip"
        disabled={replace}
        checked={effectiveMode === 'skip'}
        onchange={() => (mode = 'skip')}
      />
      <span>{t('import_mode_skip')}</span>
    </label>
  </fieldset>
  {#if published && ok && mode === 'atomic' && ok.counts.problem_rows > 0}
    <p class="text-xs text-destructive" role="alert">{t('import_atomic_blocked')}</p>
  {/if}

  <div class="space-y-1">
    <div class="flex items-center space-x-2">
      <Checkbox
        id="replace-data"
        checked={replace}
        disabled={busy}
        onCheckedChange={(c) => (replace = c === true)}
      />
      <Label for="replace-data" class="cursor-pointer text-sm font-normal">{t('import_replace')}</Label>
    </div>
    {#if replace}
      <p class="text-xs text-destructive" data-testid="import-replace-warning">
        {t('import_replace_warning')}
      </p>
    {/if}
  </div>

  {#if failure}
    <p role="alert" class="flex flex-wrap items-center gap-x-2 text-sm text-destructive">
      {failure.text}
      {#if failure.href}<a class="underline" href={failure.href}>{failure.hrefLabel}</a>{/if}
    </p>
  {/if}
</div>
<Dialog.Footer>
  <Button variant="outline" onclick={onback} disabled={busy}>{t('import_back')}</Button>
  <Button onclick={onimport} disabled={busy || blocked || failed !== null} data-testid="import-start">
    {#if busy}{t(published ? 'import_importing' : 'import_publishing')}{:else}{t(
        published ? 'import_import' : 'import_publish_import',
      )}{/if}
  </Button>
</Dialog.Footer>
