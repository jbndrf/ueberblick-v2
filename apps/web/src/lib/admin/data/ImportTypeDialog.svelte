<script lang="ts">
  // "Aus Projekt importieren" (v3 `workflow-import-dialog.svelte`): pick another project, then one of its Objektarten; the
  // design is copied into this project's draft with the permissions reset (v3's description says so). v3 fetched the
  // workflows when a project was picked ("Wird geladen..."); one call on opening brings every project with its types, so the
  // second select fills at once. Native selects, as in v3 (a phone shows its own picker). A failure shows as a toast.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { MenuApi } from './menu-api';
  import type { CopyDone, ImportSource } from './menu-types';

  let {
    open = $bindable(false),
    locale = 'de',
    api,
    onImported,
  }: {
    open?: boolean;
    locale?: Locale;
    api: MenuApi;
    /** The copy is in the draft: the page opens it. */
    onImported: (copy: CopyDone) => void | Promise<void>;
  } = $props();
  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const selectClass =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

  let sources = $state<readonly ImportSource[]>([]);
  let loading = $state(false);
  let project = $state('');
  let type = $state('');
  let submitting = $state(false);
  const types = $derived(sources.find((s) => s.key === project)?.types ?? []);

  $effect(() => {
    if (!open) return;
    loading = true;
    void api.call({ action: 'sources' }).then((r) => {
      loading = false;
      if (!r.ok) toast.error(r.message);
      else if (r.answer.kind === 'sources') sources = r.answer.sources;
    });
  });
  function reset(): void {
    project = '';
    type = '';
  }

  async function submit(): Promise<void> {
    if (type === '' || submitting) return;
    submitting = true;
    const r = await api.call({ action: 'import', project, type });
    submitting = false;
    if (!r.ok) return void toast.error(r.message);
    if (r.answer.kind !== 'copy') return;
    toast.success(t('data_menu_import_success'));
    open = false;
    reset();
    await onImported(r.answer.copy);
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(o) => {
    if (!o) reset();
  }}
>
  <Dialog.Content class="sm:max-w-md" data-testid="import-type-dialog">
    <Dialog.Header>
      <Dialog.Title>{t('data_menu_import_title')}</Dialog.Title>
      <Dialog.Description>{t('data_menu_import_description')}</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4 py-4">
      <div class="grid gap-2">
        <Label for="import-project">{t('data_menu_import_project')}</Label>
        <select
          id="import-project"
          value={project}
          disabled={loading}
          onchange={(e) => {
            project = e.currentTarget.value;
            type = '';
          }}
          class={selectClass}
        >
          <option value="">
            {loading ? t('data_menu_import_loading') : t('data_menu_import_project_placeholder')}
          </option>
          {#each sources as source (source.key)}
            <option value={source.key}>{source.name}</option>
          {/each}
        </select>
      </div>
      <div class="grid gap-2">
        <Label for="import-type">{t('data_menu_import_type')}</Label>
        <select
          id="import-type"
          value={type}
          onchange={(e) => (type = e.currentTarget.value)}
          disabled={project === ''}
          class={selectClass}
        >
          <option value="">{t('data_menu_import_type_placeholder')}</option>
          {#each types as entry (entry.key)}
            <option value={entry.key}>{entry.label}</option>
          {/each}
        </select>
        {#if project !== '' && types.length === 0}
          <p class="text-xs text-muted-foreground">{t('data_menu_import_no_types')}</p>
        {/if}
      </div>
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{t('data_menu_cancel')}</Button>
      <Button
        onclick={() => void submit()}
        disabled={type === '' || submitting}
        data-testid="import-type-submit"
      >
        {submitting ? t('data_menu_import_in_progress') : t('data_menu_import_button')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
