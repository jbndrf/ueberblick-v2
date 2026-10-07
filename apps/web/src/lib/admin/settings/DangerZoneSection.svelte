<script lang="ts">
  // v3 `settings/sections/DangerZoneSection.svelte:111-277`: one card with a red border (icon, "Projekt löschen", the
  // hint with the name, the red button) and the confirm dialog: title, sentence, "Wird ebenfalls gelöscht" with the
  // counts (configuration rows, then one bold row of the data), the typed confirmation, Abbrechen and a red Löschen.
  // v4: the typed confirmation is the project key (always, v3 asked for the number of entries only when there were
  // some); the counts are the v4 ones (Objektarten, Rollen, Kartenebenen, Offline-Pakete, Infoseiten, Teilnehmende,
  // Objekte; v3's own tables do not exist). After the delete the page leaves for the project list.
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';
  import type { DeleteCounts } from './types';

  let { data, locale, project, api }: SectionProps = $props();
  const t = (key: AdminKey, values: Readonly<Record<string, string | number>> = {}): string =>
    adminMessage(locale, key, values);

  let open = $state(false);
  let deleting = $state(false);
  let counts = $state<DeleteCounts | null>(null);
  let loading = $state(false);
  let typed = $state('');
  const confirmed = $derived(counts !== null && typed.trim() === project);

  const CONFIG_ROWS: readonly [keyof DeleteCounts, AdminKey][] = [
    ['types', 'settings_danger_count_types'],
    ['roles', 'settings_danger_count_roles'],
    ['layers', 'settings_danger_count_layers'],
    ['packs', 'settings_danger_count_packs'],
    ['infoPages', 'settings_danger_count_info_pages'],
  ];
  const DATA_ROWS: readonly [keyof DeleteCounts, AdminKey][] = [
    ['participants', 'settings_danger_count_participants'],
    ['features', 'settings_danger_count_features'],
  ];
  const rows = (c: DeleteCounts, list: typeof CONFIG_ROWS): string[] =>
    list.filter(([k]) => c[k] > 0).map(([k, key]) => t(key, { n: c[k] }));

  /** v3 loaded the dependencies when the dialog opened and forgot them when it closed. */
  $effect(() => {
    if (open && counts === null && !loading) {
      loading = true;
      void api.deleteCounts().then((r) => {
        loading = false;
        if (r.ok) counts = r.value;
        else open = false;
        if (!r.ok) toast.error(t('settings_danger_error'));
      });
    }
    if (!open) {
      counts = null;
      typed = '';
    }
  });

  async function remove(): Promise<void> {
    if (deleting || !confirmed) return;
    deleting = true;
    const r = await api.deleteProject(typed.trim());
    deleting = false;
    if (!r.ok) return void toast.error(t('settings_danger_error'));
    toast.success(t('settings_danger_success'));
    window.location.assign('/admin/projects');
  }
</script>

<SettingsSection name={t('settings_danger_title')} description={t('settings_danger_description')}>
  <div
    class="flex flex-col gap-4 rounded-md border border-destructive/50 p-4 sm:flex-row sm:items-center sm:justify-between"
  >
    <div>
      <div class="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle class="h-4 w-4" />
        {t('settings_danger_delete')}
      </div>
      <div class="mt-1 text-sm text-muted-foreground">
        {t('settings_danger_hint', { name: data.projectName })}
      </div>
    </div>
    <Button variant="destructive" onclick={() => (open = true)}>
      <Trash2 class="mr-2 h-4 w-4" />
      {t('settings_danger_delete')}
    </Button>
  </div>
</SettingsSection>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('settings_danger_delete')}</AlertDialog.Title>
      <AlertDialog.Description>
        {t('settings_danger_intro', { name: data.projectName })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <div class="space-y-3 text-sm">
      {#if counts === null}
        <div class="text-muted-foreground">{t('settings_danger_loading')}</div>
      {:else}
        {@const config = rows(counts, CONFIG_ROWS)}
        {@const records = rows(counts, DATA_ROWS)}
        {#if config.length === 0 && records.length === 0}
          <div class="text-muted-foreground">{t('settings_danger_none')}</div>
        {:else}
          <div class="font-medium">{t('settings_danger_also_deleted')}</div>
          <ul class="list-disc space-y-0.5 pl-5 text-muted-foreground" data-testid="delete-counts">
            {#each config as row (row)}<li>{row}</li>{/each}
            {#if records.length > 0}
              <li class="font-semibold text-foreground">{records.join(' · ')}</li>
            {/if}
          </ul>
        {/if}
        <div class="space-y-2 border-t pt-2">
          <Label for="project-delete-confirm">{t('settings_danger_confirm_prompt', { key: project })}</Label>
          <Input
            id="project-delete-confirm"
            autocomplete="off"
            bind:value={typed}
            placeholder={t('settings_danger_confirm_placeholder')}
          />
        </div>
      {/if}
    </div>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>{t('settings_danger_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
        onclick={(e: MouseEvent) => {
          e.preventDefault();
          void remove();
        }}
        disabled={deleting || !confirmed}
      >
        {t('settings_danger_confirm')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
