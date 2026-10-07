<script lang="ts">
  // Engine-new (owner 2026-10-05, no v3 counterpart): the draft's whole project file as text. The admin edits it or
  // pastes a whole file over it; "Übernehmen" checks it on the server with the builder's own file check (no second
  // parser) and, only when nothing blocks, stores it as the draft. Problems are listed with their paths as the import
  // dialog lists them. Nothing here publishes: Veröffentlichen above stays the one release step.
  import { onMount } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import { createProjectFileClient, type FileProblem } from './project-file-client';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';

  let { locale, project, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);
  const client = $derived(createProjectFileClient(project, (input, init) => fetch(input, init)));

  let saved = $state('');
  let text = $state('');
  let revision = $state(0);
  let loaded = $state(false);
  let failed = $state(false);
  let busy = $state(false);
  let problems = $state<readonly FileProblem[]>([]);

  async function load(): Promise<void> {
    const r = await client.load();
    failed = !r.ok;
    if (!r.ok) return;
    saved = text = r.text;
    revision = r.revision;
    loaded = true;
  }
  onMount(() => void load());

  async function apply(): Promise<void> {
    if (busy) return;
    busy = true;
    const r = await client.apply(text, revision);
    busy = false;
    if (r.ok) {
      problems = [];
      saved = text;
      revision = r.revision;
      notifyDraftChanged();
      toast.success(t('settings_project_file_applied'));
      await reload();
    } else if (r.conflict) {
      toast.error(t('settings_err_conflict'));
    } else if (r.problems.length > 0) problems = r.problems;
    else toast.error(t('settings_err_failed'));
  }
</script>

<SettingsSection name={t('settings_project_file_title')} description={t('settings_project_file_description')}>
  <div class="flex flex-col gap-3" data-testid="project-file">
    {#if failed}
      <p class="text-sm text-destructive" role="alert">{t('settings_project_file_load_failed')}</p>
    {:else if loaded}
      <Textarea
        bind:value={text}
        aria-label={t('settings_project_file_label')}
        data-testid="project-file-text"
        class="min-h-64 font-mono text-xs"
        spellcheck={false}
        wrap="off"
      />
      {#if problems.length > 0}
        <div role="alert" class="flex flex-col gap-1">
          <p class="text-sm font-medium text-destructive">{t('settings_project_file_problems_title')}</p>
          <p class="text-xs text-muted-foreground">{t('settings_project_file_problems_hint')}</p>
          <ul class="max-h-72 space-y-2 overflow-y-auto py-2 text-sm" data-testid="project-file-problems">
            {#each problems as problem, i (i)}
              <li class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                {#if problem.path}<code class="mr-2 text-xs font-semibold">{problem.path}</code>{/if}
                <span>{problem.message}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <div class="flex flex-wrap gap-2">
        <Button
          disabled={busy || text === saved}
          onclick={() => void apply()}
          data-testid="project-file-apply"
        >
          {t('settings_project_file_apply')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || text === saved}
          onclick={() => {
            text = saved;
            problems = [];
          }}
        >
          {t('settings_project_file_reset')}
        </Button>
      </div>
    {/if}
  </div>
</SettingsSection>
