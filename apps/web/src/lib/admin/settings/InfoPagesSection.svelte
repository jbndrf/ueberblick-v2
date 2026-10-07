<script lang="ts">
  // v3 `settings/sections/InfoPagesSection.svelte:60-250`: the section header with "Infoseite hinzufügen", an empty
  // state, one card per page (icon, title, two lines of its text without markup, "Sortierung: n", Bearbeiten, and a
  // trash button that turns into a red "Löschen" for the second click) and the create/edit dialog. v4: a page is
  // `info_pages.<key>` in the draft; the participant app shows it after Veröffentlichen.
  import FileText from '@lucide/svelte/icons/file-text';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import InfoPageDialog from './InfoPageDialog.svelte';
  import { plainText, type InfoPageRow, type InfoPageValues } from './info-pages';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';

  let { data, locale, api, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let dialogOpen = $state(false);
  let editing = $state<InfoPageRow | null>(null);
  let confirmKey = $state<string | null>(null);

  function openCreate(): void {
    editing = null;
    dialogOpen = true;
  }
  function openEdit(page: InfoPageRow): void {
    editing = page;
    dialogOpen = true;
  }

  async function changed(): Promise<void> {
    notifyDraftChanged();
    await reload();
  }

  async function save(values: InfoPageValues): Promise<void> {
    const wasEdit = values.key !== undefined;
    const r = await api.saveInfoPage(values);
    if (!r.ok) return void toast.error(r.message || t(wasEdit ? 'info_update_error' : 'info_create_error'));
    toast.success(t(wasEdit ? 'info_update_success' : 'info_create_success'));
    dialogOpen = false;
    editing = null;
    await changed();
  }

  async function remove(key: string): Promise<void> {
    const r = await api.deleteInfoPage(key);
    if (!r.ok) return void toast.error(r.message || t('info_delete_error'));
    toast.success(t('info_delete_success'));
    confirmKey = null;
    await changed();
  }
</script>

<SettingsSection name={t('info_title')} description={t('info_description')}>
  {#snippet actions()}
    <Button onclick={openCreate}>
      <Plus class="mr-2 h-4 w-4" />
      {t('info_create')}
    </Button>
  {/snippet}

  {#if data.infoPages.length === 0}
    <div class="rounded-lg border border-dashed p-8 text-center" data-testid="info-empty">
      <FileText class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-2 text-sm font-semibold">{t('info_empty')}</h3>
      <p class="mt-1 text-sm text-muted-foreground">{t('info_empty_description')}</p>
    </div>
  {:else}
    <ul class="space-y-3" data-testid="info-list">
      {#each data.infoPages as page (page.key)}
        <li class="rounded-lg border p-4" data-testid="info-page" data-key={page.key}>
          <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 items-start gap-3">
              <FileText class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div class="min-w-0">
                <h3 class="font-medium break-words">{page.title}</h3>
                <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{plainText(page.content)}</p>
                <p class="mt-1 text-xs text-muted-foreground">{t('info_sort')}: {page.sortOrder}</p>
              </div>
            </div>
            <div class="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" aria-label={t('info_edit')} onclick={() => openEdit(page)}>
                <Pencil class="h-4 w-4" />
              </Button>
              {#if confirmKey === page.key}
                <Button variant="destructive" size="sm" onclick={() => void remove(page.key)}>
                  {t('info_delete')}
                </Button>
              {:else}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('info_delete')}
                  onclick={() => (confirmKey = page.key)}
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</SettingsSection>

<InfoPageDialog bind:open={dialogOpen} {locale} page={editing} onsave={save} />
