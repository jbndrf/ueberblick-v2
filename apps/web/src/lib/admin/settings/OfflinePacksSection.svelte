<script lang="ts">
  // v3 `settings/sections/OfflinePacksSection.svelte:295-552` ("Offline-Pakete"): the header with "Paket erstellen"
  // (disabled without layers), the two empty states (no layers, no packages), the BaseTable (Name, Status, Zoom,
  // Kacheln, Größe, Sichtbar für Rollen as an inline editable column, Bearbeitungsmodus switch, a row menu with
  // Löschen), the create dialog and the delete confirm. v4: a pack is `map.packs.<key>` in the draft; it builds after
  // Veröffentlichen, and the Status column follows the build through the existing endpoint (A-032) with progress, the
  // reason of a failure and "Neu bauen".
  import Package from '@lucide/svelte/icons/package';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { onMount, untrack } from 'svelte';
  import type { PackStatus } from '@ueberblick/server';
  import { BaseTable, CellRefusal, type TableColumn, type TableRow } from '@ueberblick/ui/components/admin';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { draftStatus, notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import { POLL_MS, buildOf, isBuilding, type PackShown } from './pack-status';
  import { formatBytes, formatTileCount, type PackRow, type PackValues } from './packs';
  import PackDialog from './PackDialog.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';

  let { data, locale, api, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let createOpen = $state(false);
  let deleteOpen = $state(false);
  let target = $state<PackRow | null>(null);
  let statuses = $state<readonly PackStatus[] | null>(null);

  const builds = $derived(new Map(data.packs.map((p) => [p.key, buildOf(p, statuses)])));
  const targetBuild = $derived(target === null ? undefined : builds.get(target.key));
  const rows = $derived<TableRow[]>(
    data.packs.map((p) => {
      const b = builds.get(p.key);
      return {
        id: p.key,
        name: p.name,
        status: b?.shown ?? 'draft',
        zoom: `${p.minZoom}-${p.maxZoom}`,
        tiles:
          b === undefined || b.shown === 'draft'
            ? '-'
            : `${b.approx ? '≈ ' : ''}${b.tiles.toLocaleString(locale)}`,
        size: formatBytes(b?.bytes),
        roles: [...p.roles],
        percent: b?.percent ?? null,
        error: b?.error ?? null,
      };
    }),
  );

  const columns = $derived<TableColumn[]>([
    { key: 'name', label: t('pack_col_name'), kind: 'text', editable: false },
    { key: 'status', label: t('pack_col_status'), kind: 'custom', editable: false, cell: statusCell },
    { key: 'zoom', label: t('pack_col_zoom'), kind: 'text', editable: false, sortable: false },
    { key: 'tiles', label: t('pack_col_tiles'), kind: 'text', editable: false },
    { key: 'size', label: t('pack_col_size'), kind: 'text', editable: false },
    {
      key: 'roles',
      label: t('pack_col_roles'),
      kind: 'array',
      editable: true,
      sortable: false,
      emptyText: t('pack_roles_ph'),
      options: data.roles.map((r) => ({ value: r.key, label: r.label, description: r.description })),
    },
  ]);

  async function refresh(): Promise<void> {
    const r = await api.packStatuses();
    // before the first publish there is no deployed config: the endpoint refuses, and every pack is a draft
    statuses = r.ok ? r.value : null;
  }

  // Ask once on mount, and again after the draft was published (the bar re-read the status), because a publish is
  // what starts a build. Then keep asking only while a pack is queued or building: an idle table makes no requests.
  onMount(() => void refresh());
  let seenStatus = draftStatus.status;
  $effect(() => {
    const now = draftStatus.status;
    if (now === seenStatus) return;
    seenStatus = now;
    untrack(() => void refresh());
  });
  $effect(() => {
    if (!isBuilding(statuses)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  });

  async function changed(): Promise<void> {
    notifyDraftChanged();
    await reload();
    await refresh();
  }

  async function create(values: PackValues): Promise<void> {
    const r = await api.savePack(values);
    if (!r.ok) return void toast.error(r.message || t('pack_create_error'));
    toast.success(t('pack_created'));
    createOpen = false;
    await changed();
  }

  async function setRoles(id: string, key: string, value: unknown): Promise<void> {
    if (key !== 'roles') return;
    const r = await api.savePackRoles(id, Array.isArray(value) ? value.map(String) : []);
    if (!r.ok) throw new CellRefusal(r.message || t('pack_update_failed'));
    await changed();
  }

  function askDelete(ids: readonly string[]): void {
    target = data.packs.find((p) => p.key === ids[0]) ?? null;
    deleteOpen = target !== null;
  }

  async function remove(): Promise<void> {
    if (target === null) return;
    const r = await api.deletePack(target.key);
    deleteOpen = false;
    if (!r.ok) return void toast.error(r.message || t('pack_delete_error'));
    toast.success(t('pack_deleted'));
    target = null;
    await changed();
  }

  async function rebuild(key: string): Promise<void> {
    const r = await api.rebuildPack(key);
    if (!r.ok) return void toast.error(r.message);
    toast.success(t('pack_rebuild_queued'));
    await refresh();
  }

  const STATUS_LABEL: Record<PackShown, AdminKey> = {
    draft: 'pack_status_draft',
    queued: 'pack_status_queued',
    building: 'pack_status_building',
    ready: 'pack_status_ready',
    failed: 'pack_status_failed',
  };
  const VARIANT: Record<PackShown, 'outline' | 'secondary' | 'default' | 'destructive'> = {
    draft: 'outline',
    queued: 'secondary',
    building: 'secondary',
    ready: 'default',
    failed: 'destructive',
  };
</script>

{#snippet statusCell({ value, row }: { value: unknown; row: TableRow })}
  {@const shown = value as PackShown}
  <div class="flex flex-col items-start gap-1" data-testid="pack-status" data-state={shown}>
    <Badge variant={VARIANT[shown]}>
      {t(STATUS_LABEL[shown])}{shown === 'building' && row['percent'] !== null ? ` ${row['percent']} %` : ''}
    </Badge>
    {#if shown === 'failed'}
      {#if row['error']}<span class="max-w-56 text-xs break-words text-destructive">{row['error']}</span>{/if}
      <Button variant="outline" size="sm" onclick={() => void rebuild(String(row['id']))}>
        <RefreshCw class="mr-1 h-3 w-3" />
        {t('pack_rebuild')}
      </Button>
    {/if}
  </div>
{/snippet}

<SettingsSection name={t('pack_title')} description={t('pack_description')}>
  {#snippet actions()}
    <Button onclick={() => (createOpen = true)} disabled={data.packLayers.length === 0}>
      <Plus class="mr-2 h-4 w-4" />
      {t('pack_create')}
    </Button>
  {/snippet}

  {#if data.packLayers.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-center"
      data-testid="pack-empty-layers"
    >
      <Package class="mb-4 h-12 w-12 text-muted-foreground" />
      <p class="text-lg font-medium">{t('pack_no_layers')}</p>
      <p class="mb-4 text-muted-foreground">{t('pack_add_layers_first')}</p>
    </div>
  {:else if data.packs.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-center"
      data-testid="pack-empty"
    >
      <Package class="mb-4 h-12 w-12 text-muted-foreground" />
      <p class="text-lg font-medium">{t('pack_none')}</p>
      <p class="mb-4 text-muted-foreground">{t('pack_none_description')}</p>
      <Button onclick={() => (createOpen = true)}>
        <Plus class="mr-2 h-4 w-4" />
        {t('pack_create')}
      </Button>
    </div>
  {:else}
    <BaseTable
      {rows}
      {columns}
      {locale}
      showToolbar
      showEditMode
      editModeLabel={t('pack_edit_mode')}
      emptyMessage={t('pack_none')}
      emptySubMessage={t('pack_create_hint')}
      onEdit={setRoles}
      onDelete={askDelete}
      rowMenu={{ header: t('pack_actions') }}
    />
  {/if}
</SettingsSection>

<PackDialog bind:open={createOpen} {locale} {data} onsave={create} />

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('pack_delete_title')}</AlertDialog.Title>
      <AlertDialog.Description>
        {t('pack_delete_confirmation')}
        {#if target}
          <strong class="mt-2 block">{target.name}</strong>
          {#if targetBuild?.shown === 'ready'}
            <span class="mt-1 block text-sm text-muted-foreground">
              {formatTileCount(targetBuild.tiles)}
              {t('region_tiles')}, {formatBytes(targetBuild.bytes)}
            </span>
          {/if}
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{t('pack_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void remove()}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {t('pack_delete')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
