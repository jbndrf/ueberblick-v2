<script lang="ts">
  // The Tabellen overview (v3 `custom-tables/+page.svelte`, linked from nowhere in v3; here the Tabellen group of the
  // sidebar opens it): title and description, then one BaseTable of the project's tables: Tabellenname, Anzeigename,
  // Beschreibung, Hauptspalte and "Sichtbar für Rollen", with inline editing in Bearbeitungsmodus, the always-visible
  // "Tabelle erstellen" row, and the row menu: Bearbeiten (dialog), "Struktur bearbeiten" (v3's link was dead; it opens the
  // table page) and Löschen (confirm). Every change is a draft edit (Q16); the route passes the load data, the api, the
  // navigation and the reload.
  import Settings from '@lucide/svelte/icons/settings';
  import { BaseTable, CellRefusal, type TableColumn, type TableRow } from '@ueberblick/ui/components/admin';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import ConfirmDialog from '../participants/ConfirmDialog.svelte';
  import type { CallResult } from '../participants/types';
  import type { TablesApi } from './api';
  import type { OverviewData } from './load.server';
  import TableEditDialog, { type TableValues } from './TableEditDialog.svelte';

  let {
    data,
    locale,
    project,
    api,
    reload,
    open,
    draftChanged,
  }: {
    data: OverviewData;
    locale: Locale;
    project: string;
    api: TablesApi;
    reload: () => Promise<void>;
    /** Opens a table's page (v3 `window.location.href`). */
    open: (href: string) => void;
    draftChanged: () => void;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const KEY = 'table_name';
  const rows = $derived<TableRow[]>(
    data.tables.map((tb) => ({
      id: tb.key,
      [KEY]: tb.key,
      display_name: tb.label,
      description: tb.description,
      main_column: tb.mainLabel,
      visible_to_roles: tb.audience.kind === 'roles' ? [...tb.audience.roles] : [],
    })),
  );
  const columns = $derived<TableColumn[]>([
    { key: KEY, label: t('tbl_col_name'), kind: 'text', editable: false },
    { key: 'display_name', label: t('tbl_col_display'), kind: 'text', editable: true },
    { key: 'description', label: t('tbl_col_desc'), kind: 'text', editable: true },
    { key: 'main_column', label: t('tbl_col_main'), kind: 'text', editable: false, filterable: false },
    {
      key: 'visible_to_roles',
      label: t('tbl_col_roles'),
      kind: 'array',
      editable: true,
      sortable: false,
      filterable: false,
      options: data.roles.map((r) => ({ value: r.key, label: r.label })),
      emptyText: t('tbl_roles_all'),
    },
  ]);
  const idOf = (row: TableRow): string => String(row['id']);

  /** A change made: the shell's publish bar follows, the lists read the draft again. */
  async function changed(): Promise<void> {
    draftChanged();
    await reload();
  }

  /** One in-place edit (v3 `updateField`). A refusal is thrown as a `CellRefusal` so the cell keeps what was typed. */
  async function edit(id: string, key: string, value: unknown): Promise<void> {
    const text = String(value ?? '').trim();
    const result =
      key === 'display_name'
        ? await api.update(id, { name: text })
        : key === 'description'
          ? await api.update(id, { description: text })
          : await api.update(id, { roles: Array.isArray(value) ? value.map(String) : [] });
    if (!result.ok) throw new CellRefusal(result.message);
    await changed();
  }

  /** The inline "Tabelle erstellen" row (v3 `onCreateRow`): table name, display name, Hauptspalte, description, roles. */
  async function add(values: TableRow): Promise<void> {
    const text = (key: string): string => String(values[key] ?? '').trim();
    const result = await api.create({
      key: text(KEY),
      name: text('display_name'),
      description: text('description'),
      mainColumn: text('main_column'),
      roles: Array.isArray(values['visible_to_roles'])
        ? (values['visible_to_roles'] as unknown[]).map(String)
        : [],
    });
    if (!result.ok) {
      toast.error(result.message || t('tbl_create_error'));
      throw new CellRefusal(result.message);
    }
    toast.success(t('tbl_create_ok'));
    await changed();
  }

  let editTarget = $state<TableRow | null>(null);
  let editOpen = $state(false);
  let deleteTarget = $state<TableRow | null>(null);
  let deleteOpen = $state(false);
  const summaryOf = (row: TableRow | null) =>
    data.tables.find((tb) => tb.key === (row ? idOf(row) : '')) ?? null;

  async function saveEdit(values: TableValues): Promise<void> {
    if (!editTarget) return;
    const result: CallResult<null> = await api.update(idOf(editTarget), values);
    if (!result.ok) {
      toast.error(result.message || t('tbl_update_error'));
      return;
    }
    editOpen = false;
    editTarget = null;
    toast.success(t('tbl_update_ok'));
    await changed();
  }

  async function remove(): Promise<void> {
    if (!deleteTarget) return;
    const result = await api.remove(idOf(deleteTarget));
    deleteOpen = false;
    deleteTarget = null;
    if (!result.ok) {
      toast.error(result.message || t('tbl_delete_error'));
      return;
    }
    toast.success(t('tbl_delete_ok'));
    await changed();
  }
</script>

<div class="flex h-[calc(100svh-4rem)] min-h-[28rem] w-full min-w-0 flex-col gap-6">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">{t('tbl_title')}</h1>
    <p class="text-muted-foreground">{t('tbl_description')}</p>
  </div>

  <BaseTable
    {rows}
    {columns}
    {locale}
    selectable
    shiftSelect
    showToolbar
    showEditMode
    editModeLabel={t('tbl_edit_mode')}
    emptyMessage={t('tbl_empty')}
    emptySubMessage={t('tbl_empty_hint')}
    onEdit={edit}
    onAdd={add}
    addRow={{ requiredKeys: [KEY, 'display_name', 'main_column'] }}
    onDelete={(ids) => {
      deleteTarget = rows.find((r) => idOf(r) === ids[0]) ?? null;
      deleteOpen = deleteTarget !== null;
    }}
    rowMenu={{
      header: t('tbl_actions'),
      onEdit: (row) => {
        editTarget = row;
        editOpen = true;
      },
      items: [
        {
          label: t('tbl_edit_structure'),
          icon: Settings,
          onSelect: (row) => open(`/admin/projects/${project}/tables/${idOf(row)}`),
        },
      ],
    }}
  />
</div>

<TableEditDialog
  bind:open={editOpen}
  {locale}
  table={summaryOf(editTarget)}
  roles={data.roles}
  onsave={saveEdit}
/>
<ConfirmDialog
  bind:open={deleteOpen}
  title={t('tbl_delete')}
  description={t('tbl_delete_confirm')}
  confirmLabel={t('tbl_delete_action')}
  cancelLabel={t('tbl_cancel')}
  onconfirm={remove}
/>
