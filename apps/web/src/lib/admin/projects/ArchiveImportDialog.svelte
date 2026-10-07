<script lang="ts">
  // "Gesamtes Projekt importieren (ZIP)" (v3 `+page.svelte:368-426`): the dialog names the file and its size, offers a
  // name override, then shows the phase (upload, processing), a progress bar with percent and a label, and the result.
  // Closing it while a phase runs lets the import go on and the page toasts the result (v3 `onOpenChange`). v3's phase words, "Queued" and "Name override
  // (optional)" were English in the German app; they are catalogue strings here. A failed import lists its problems
  // (v3 showed one line) and says when a project was begun anyway.
  import { untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Progress } from '@ueberblick/ui/components/ui/progress';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { pollImport, uploadArchive, type ImportJob } from './archive-client';

  type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'failed';

  let {
    open = $bindable(false),
    busy = $bindable(false),
    locale,
    file,
    onimported,
    onfailed,
  }: {
    open?: boolean;
    /** True while an upload or the processing runs (v3 `importingArchive`): the page disables the menu item. */
    busy?: boolean;
    locale: Locale;
    file: File | null;
    /** The import finished: the page reloads its list and says so. */
    onimported: (renewedTokens: number) => void;
    /** The import did not finish: the page toasts it, also when the dialog was closed meanwhile (v3 `toast.error`). */
    onfailed: (message: string) => void;
  } = $props();
  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const uid = $props.id();
  const mb = (bytes: number): number => Math.floor(bytes / 1024 / 1024);

  let name = $state('');
  let phase = $state<Phase>('idle');
  let percent = $state(0);
  let label = $state('');
  let failure = $state('');
  /** Participants that got new login links because theirs were in use here (A-046). */
  let renewed = $state(0);
  let problems = $state<ImportJob['problems']>([]);
  /** A limit refusal has a typed code and is said in the user's language; any other problem is the server's text. */
  const CODES = {
    entry_too_large: 'projects_import_archive_code_entry_too_large',
    archive_too_large: 'projects_import_archive_code_archive_too_large',
    entry_over_declared: 'projects_import_archive_code_entry_over_declared',
    text_too_large: 'projects_import_archive_code_text_too_large',
    line_too_long: 'projects_import_archive_code_line_too_long',
    token_duplicate: 'projects_import_archive_code_token_duplicate',
  } as const satisfies Record<string, AdminKey>;
  const problemText = (p: { message: string; code?: string }): string =>
    p.code !== undefined && p.code in CODES ? t(CODES[p.code as keyof typeof CODES]) : p.message;
  const running = $derived(phase === 'uploading' || phase === 'processing');
  $effect(() => {
    busy = running;
  });

  function reset(): void {
    name = '';
    phase = 'idle';
    percent = 0;
    label = '';
    failure = '';
    problems = [];
    renewed = 0;
  }
  // a new file starts a fresh dialog
  $effect(() => {
    if (file && !untrack(() => running)) untrack(reset);
  });

  async function start(): Promise<void> {
    if (!file || running) return;
    phase = 'uploading';
    percent = 0;
    failure = '';
    const sent = await uploadArchive(file, name, (p, loaded, total) => {
      percent = p;
      label = t('projects_import_archive_mb', { loaded: mb(loaded), total: mb(total) });
    });
    if (!sent.ok) {
      phase = 'failed';
      failure =
        sent.status === 413 ? t('projects_import_archive_too_large') : t('projects_import_archive_error');
      onfailed(failure);
      return;
    }
    phase = 'processing';
    percent = 0;
    label = t('projects_import_archive_queued');
    const end = await pollImport(sent.job, (j) => {
      percent = j.total > 0 ? Math.round((100 * j.done) / j.total) : 0;
      label = j.total > 0 ? t('projects_import_archive_rows', { done: j.done, total: j.total }) : label;
    });
    if (end.state === 'done') {
      phase = 'done';
      percent = 100;
      renewed = end.renewedTokens ?? 0;
      onimported(renewed);
      return;
    }
    phase = 'failed';
    problems = end.problems ?? [];
    failure = problems && problems.length > 0 ? '' : t('projects_import_archive_lost');
    onfailed(problems?.[0] ? problemText(problems[0]) : failure);
  }

  const phaseLabel = $derived(
    (
      {
        idle: '',
        uploading: t('projects_import_archive_uploading'),
        processing: t('projects_import_archive_processing'),
        done: t('projects_import_archive_done'),
        failed: t('projects_import_archive_failed'),
      } satisfies Record<Phase, string>
    )[phase],
  );
</script>

<Dialog.Root
  bind:open
  onOpenChange={(o) => {
    if (!o && !running) reset();
  }}
>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('projects_import_archive')}</Dialog.Title>
    </Dialog.Header>
    <div class="space-y-4">
      {#if file}
        <div class="text-sm text-muted-foreground" data-testid="archive-file">
          {file.name} — {mb(file.size)} MB
        </div>
      {/if}
      {#if phase === 'idle'}
        <div class="space-y-2">
          <Label for="{uid}-name">{t('projects_import_archive_name')}</Label>
          <Input
            id="{uid}-name"
            bind:value={name}
            placeholder={t('projects_import_archive_name_placeholder')}
          />
        </div>
      {:else}
        <div class="space-y-2" aria-live="polite">
          <div class="text-sm font-medium" data-testid="archive-phase">{phaseLabel}</div>
          <Progress value={percent} max={100} aria-label={phaseLabel} />
          <div class="text-xs text-muted-foreground">{percent}%{label ? ` — ${label}` : ''}</div>
          {#if renewed > 0}<div class="text-sm" data-testid="archive-renewed">
              {t('projects_import_archive_renewed', { n: renewed })}
            </div>{/if}
          {#if failure}<div role="alert" class="text-sm text-destructive">{failure}</div>{/if}
          {#if problems && problems.length > 0}
            <ul class="max-h-48 space-y-2 overflow-y-auto text-sm" data-testid="archive-problems">
              {#each problems as problem, i (i)}
                <li class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  {#if problem.path}<code class="mr-2 text-xs font-semibold">{problem.path}</code>{/if}
                  <span>{problemText(problem)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
    <Dialog.Footer>
      {#if phase === 'idle'}
        <Button variant="outline" onclick={() => (open = false)}>{t('projects_cancel')}</Button>
        <Button onclick={start} disabled={!file}>{t('projects_import_archive_submit')}</Button>
      {:else if phase === 'done' || phase === 'failed'}
        <Button onclick={() => (open = false)}>{t('projects_close')}</Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
