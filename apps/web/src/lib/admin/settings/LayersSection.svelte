<script lang="ts">
  // v3 `settings/sections/LayersSection.svelte` (Kartenebenen): the heading with the names of the base layers (or the hint
  // to add one) and "Layer hinzufügen"; an empty state with a map icon; a BaseTable of the layers (Layer-Name, Typ,
  // Deckkraft, Sichtbar für Rollen, Basis) with search/filter toolbar, Bearbeitungsmodus, and a row menu ("Als Basis/Overlay
  // setzen", Löschen); the add dialog and the delete confirmation. v4: every write is an edit of the draft's `map.layers`
  // and `map.order` (the publish bar follows); the row menu also has Bearbeiten (all settings of a layer), Nach oben and
  // Nach unten (the draw order); a column says whether the tile proxy serves the layer.
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import MapIcon from '@lucide/svelte/icons/map';
  import Plus from '@lucide/svelte/icons/plus';
  import Star from '@lucide/svelte/icons/star';
  import { BaseTable, CellRefusal, type TableRow } from '@ueberblick/ui/components/admin';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import LayerAddDialog from './LayerAddDialog.svelte';
  import LayerDeleteDialog from './LayerDeleteDialog.svelte';
  import LayerEditDialog from './LayerEditDialog.svelte';
  import {
    baseNames,
    type LayerDraft,
    type LayerOp,
    type LayerPatch,
    type LayerRowData,
  } from './layers-model';
  import { KEYS, rowsOf, tableColumns } from './layers-table';
  import { archiveOfUrl, removeArchive } from './tile-upload';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';

  let { data, locale, project, api, reload }: SectionProps = $props();
  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const layers = $derived(data.layers.layers);
  const rows = $derived(rowsOf(layers));
  const bases = $derived(baseNames(layers));
  let addOpen = $state(false);
  let editKey = $state<string | null>(null);
  let editOpen = $state(false);
  let deleteKey = $state<string | null>(null);
  let deleteOpen = $state(false);

  const find = (key: string | null) => layers.find((l) => l.key === key) ?? null;
  const keyOf = (row: TableRow): string => String(row['id']);

  /** One write to the draft: a toast says what happened, the publish bar and the list follow. True when it worked. */
  async function save(op: LayerOp, done: AdminKey, failed: AdminKey): Promise<boolean> {
    const r = await api.saveLayers(op);
    if (!r.ok) {
      toast.error(r.message || t(failed));
      return false;
    }
    toast.success(t(done));
    notifyDraftChanged();
    await reload();
    return true;
  }

  const ADDED: Record<string, AdminKey> = {
    xyz: 'settings_layers_tile_added',
    wms: 'settings_layers_wms_added',
  };
  const add = (layer: LayerDraft): Promise<boolean> =>
    save(
      { op: 'add', layer },
      ADDED[layer.source.type] ?? 'settings_layers_added_toast',
      'settings_layers_add_error',
    ).then((ok) => {
      if (ok) addOpen = false;
      return ok;
    });

  /** An in-place edit of a cell; a refusal is a `CellRefusal`, so the cell keeps what was typed and shows the message. */
  async function edit(id: string, key: string, value: unknown): Promise<void> {
    const patch: LayerPatch =
      key === KEYS.name
        ? { label: String(value ?? '') }
        : key === KEYS.opacity
          ? { opacity: Math.min(100, Math.max(0, Number(value))) / 100 }
          : key === KEYS.roles
            ? { roles: (value as string[]).length === 0 ? null : (value as string[]) }
            : { on_at_start: value === true };
    const r = await api.saveLayers({ op: 'update', key: id, patch });
    if (!r.ok) throw new CellRefusal(r.message || t('settings_layers_update_failed'));
    notifyDraftChanged();
    await reload();
  }

  /** v3 `toggleLayerType`. */
  function toggleKind(row: TableRow): void {
    const layer = find(keyOf(row));
    if (layer === null) return;
    const base = layer.kind !== 'base';
    void save(
      { op: 'update', key: layer.key, patch: { kind: base ? 'base' : 'overlay' } },
      base ? 'settings_layers_set_base_done' : 'settings_layers_set_overlay_done',
      'settings_layers_kind_error',
    );
  }

  function move(row: TableRow, by: -1 | 1): void {
    const keys = layers.map((l) => l.key);
    const at = keys.indexOf(keyOf(row));
    const to = at + by;
    if (at < 0 || to < 0 || to >= keys.length) return;
    [keys[at], keys[to]] = [keys[to] as string, keys[at] as string];
    void save({ op: 'order', keys }, 'settings_layers_moved', 'settings_layers_update_failed');
  }

  async function remove(): Promise<void> {
    if (deleteKey === null) return;
    const gone = find(deleteKey);
    if (
      await save(
        { op: 'remove', key: deleteKey },
        'settings_layers_delete_done',
        'settings_layers_delete_error',
      )
    ) {
      deleteOpen = false;
      deleteKey = null;
      await dropArchive(gone);
    }
  }

  /** v3 `deleteLayer` removed the files of an uploaded layer; here the API refuses while the live map or a pack still uses the archive. */
  async function dropArchive(layer: LayerRowData | null): Promise<void> {
    const archive = layer?.type === 'pmtiles' ? archiveOfUrl(layer.url) : null;
    if (archive === null) return;
    const r = await removeArchive((...a) => fetch(...a), project, archive);
    if (!r.ok && r.references.length > 0)
      toast.info(t('settings_layers_archive_kept', { names: r.references.join(', ') }));
  }
</script>

{#snippet proxyCell({ value }: { value: unknown; row: TableRow })}
  <Badge variant={value === true ? 'secondary' : 'outline'} class="text-xs font-normal">
    {value === true ? t('settings_layers_via_server') : t('settings_layers_direct')}
  </Badge>
{/snippet}

<SettingsSection
  name={t('settings_layers_title')}
  description={bases.length > 0
    ? t('settings_layers_base_list', { names: bases.join(', ') })
    : t('settings_layers_no_base')}
>
  {#snippet actions()}
    <Button onclick={() => (addOpen = true)}>
      <Plus class="mr-2 h-4 w-4" />
      {t('settings_layers_add')}
    </Button>
  {/snippet}

  {#if layers.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-md border border-dashed px-4 py-12 text-center"
      data-testid="layers-empty"
    >
      <MapIcon class="mb-4 h-12 w-12 text-muted-foreground" />
      <p class="text-lg font-medium">{t('settings_layers_empty')}</p>
      <p class="mb-4 text-muted-foreground">{t('settings_layers_empty_hint')}</p>
      <Button onclick={() => (addOpen = true)}>
        <Plus class="mr-2 h-4 w-4" />
        {t('settings_layers_add')}
      </Button>
    </div>
  {:else}
    <div class="min-w-0" data-testid="layers-table">
      <BaseTable
        {rows}
        columns={tableColumns(locale, data.layers.roles, proxyCell)}
        {locale}
        showToolbar
        showEditMode
        editModeLabel={t('settings_layers_edit_mode')}
        emptyMessage={t('settings_layers_table_empty')}
        emptySubMessage={t('settings_layers_table_empty_hint')}
        onEdit={edit}
        onDelete={(ids) => {
          deleteKey = ids[0] ?? null;
          deleteOpen = deleteKey !== null;
        }}
        rowMenu={{
          header: t('settings_layers_actions'),
          onEdit: (row) => {
            editKey = keyOf(row);
            editOpen = true;
          },
          items: [
            {
              label: (row) =>
                find(keyOf(row))?.kind === 'base'
                  ? t('settings_layers_set_overlay')
                  : t('settings_layers_set_base'),
              icon: Star,
              onSelect: toggleKind,
            },
            { label: t('settings_layers_move_up'), icon: ArrowUp, onSelect: (row) => move(row, -1) },
            { label: t('settings_layers_move_down'), icon: ArrowDown, onSelect: (row) => move(row, 1) },
          ],
        }}
      />
    </div>
  {/if}
</SettingsSection>

<LayerAddDialog bind:open={addOpen} {locale} {layers} {project} onadd={add} />

<LayerEditDialog
  bind:open={editOpen}
  {locale}
  row={find(editKey)}
  roles={data.layers.roles}
  onsave={(key, patch) =>
    save({ op: 'update', key, patch }, 'settings_layers_updated', 'settings_layers_update_failed')}
/>

<LayerDeleteDialog bind:open={deleteOpen} {locale} layer={find(deleteKey)} onconfirm={remove} />
