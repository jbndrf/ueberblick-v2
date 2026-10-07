<script lang="ts">
  // v3 `settings/sections/FieldFiltersSection.svelte` (376 lines): two frames. "Feld-Filter" has the "Beim Start aktiv"
  // row (`ToolStartCard`, the Ansichten tool of the filter sheet, per role). "Filter-Presets" has the "Neu" action, the
  // list (name, "N Bedingung(en)", edit and delete per row, or the dashed "Noch keine Presets." box) and the dialog
  // (`PresetDialog`). v4 keeps a preset per role: a row also says which roles have it. Delete asks in an alert dialog
  // (v3 used the browser's `confirm`).
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { hydrate, type CompiledConfig } from '@ueberblick/core/hydrate';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import PresetDialog from './PresetDialog.svelte';
  import type { FiltersData, PresetRow, PresetSave } from './presets-types';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';
  import ToolStartCard from './ToolStartCard.svelte';

  let { data, locale, api, reload }: SectionProps = $props();
  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  // The presets and the compiled draft load when the section opens: a section nobody opens costs nothing.
  type Loaded =
    | { readonly state: 'loading' }
    | { readonly state: 'failed'; readonly message: string }
    | { readonly state: 'ready'; readonly filters: FiltersData; readonly config: CompiledConfig };
  let loaded = $state<Loaded>({ state: 'loading' });

  async function load(): Promise<void> {
    const r = await api.loadFilters();
    loaded = r.ok
      ? { state: 'ready', filters: r.value, config: hydrate(r.value.config) }
      : { state: 'failed', message: r.message || t('settings_filters_unavailable') };
  }
  $effect(() => {
    void load();
  });

  let dialogOpen = $state(false);
  let editing = $state<PresetRow | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let deleting = $state<PresetRow | null>(null);
  let deleteOpen = $state(false);

  function openNew(): void {
    editing = null;
    error = null;
    dialogOpen = true;
  }
  function openEdit(row: PresetRow): void {
    editing = row;
    error = null;
    dialogOpen = true;
  }
  function askDelete(row: PresetRow): void {
    deleting = row;
    deleteOpen = true;
  }

  /** A write reached the draft: the publish bar follows, then the page data and the list reload. */
  async function saved(): Promise<void> {
    toast.success(t('settings_presets_saved'));
    notifyDraftChanged();
    await Promise.all([reload(), load()]);
  }

  async function commit(preset: PresetSave): Promise<void> {
    saving = true;
    const r = await api.savePreset(preset);
    saving = false;
    if (!r.ok) return void (error = r.message || t('settings_presets_error'));
    dialogOpen = false;
    await saved();
  }

  async function remove(): Promise<void> {
    const row = deleting;
    if (row === null) return;
    deleteOpen = false;
    const r = await api.deletePreset({ key: row.key, roles: row.roles });
    if (!r.ok) return void toast.error(r.message || t('settings_presets_error'));
    await saved();
  }

  const rolesText = (row: PresetRow, all: readonly { key: string; label: string }[]): string =>
    row.roles.length === all.length
      ? t('settings_presets_all_roles')
      : t('settings_presets_roles', {
          names: row.roles.map((k) => all.find((r) => r.key === k)?.label ?? k).join(', '),
        });
</script>

<div class="flex flex-col gap-10">
  <SettingsSection name={t('settings_filters_title')} description={t('settings_filters_description')}>
    <ToolStartCard
      view={data.fieldFilters}
      tool="field_filters"
      hint="settings_filters_hint"
      {locale}
      {api}
      {reload}
    />
  </SettingsSection>

  <SettingsSection name={t('settings_presets_title')} description={t('settings_presets_description')}>
    {#snippet actions()}
      <Button size="sm" onclick={openNew} disabled={loaded.state !== 'ready'}>
        <Plus class="mr-2 size-4" />
        {t('settings_presets_new')}
      </Button>
    {/snippet}

    {#if loaded.state === 'loading'}
      <p class="text-sm text-muted-foreground" data-testid="presets-loading">
        {t('settings_filters_loading')}
      </p>
    {:else if loaded.state === 'failed'}
      <p class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" role="alert">
        {loaded.message}
      </p>
    {:else if loaded.filters.presets.length === 0}
      <div class="rounded-md border border-dashed p-6 text-center">
        <p class="text-sm text-muted-foreground">{t('settings_presets_none')}</p>
      </div>
    {:else}
      {@const all = loaded.filters.roles}
      <ul class="flex flex-col divide-y rounded-md border" data-testid="preset-list">
        {#each loaded.filters.presets as p (`${p.key}:${p.roles.join(',')}`)}
          <li class="flex items-center justify-between gap-2 px-3 py-2" data-preset={p.key}>
            <div class="flex min-w-0 flex-col">
              <span class="truncate font-medium">{p.label}</span>
              <span class="text-xs text-muted-foreground">
                {t('settings_presets_conditions', { count: p.conditions })}
                · {rolesText(p, all)}
              </span>
            </div>
            <div class="flex shrink-0 gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('settings_preset_edit_aria', { name: p.label })}
                onclick={() => openEdit(p)}
              >
                <Pencil class="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('settings_preset_delete_aria', { name: p.label })}
                onclick={() => askDelete(p)}
              >
                <Trash2 class="size-4" />
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </SettingsSection>
</div>

{#if loaded.state === 'ready'}
  <PresetDialog
    bind:open={dialogOpen}
    {locale}
    config={loaded.config}
    roles={loaded.filters.roles}
    {editing}
    {saving}
    {error}
    onsave={commit}
  />
{/if}

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('settings_preset_delete_title')}</AlertDialog.Title>
      <AlertDialog.Description>
        {t('settings_preset_delete_confirm', { name: deleting?.label ?? '' })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{t('settings_preset_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void remove()}
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
      >
        {t('settings_preset_delete')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
