<script lang="ts">
  // The table of a table page (v3 `custom-tables/[tableId]/+page.svelte:245-310`): BaseTable with one column per property
  // in the type's order, search, Bearbeitungsmodus (a row's edits are saved with the row's check as ONE Admin-Korrektur
  // run, WP-370), the "+" of the last header for the column manager, the always-visible add row ("Zeile hinzufügen", one
  // `$create` run) and the row menu with "Löschen" (one `$lifecycle` run, after v3's confirm dialog). Rows come from the
  // admin feature list API, page by page, as on the data page.
  import { onDestroy, untrack } from 'svelte';
  import { BaseTable, CellRefusal, type TableColumn, type TableRow } from '@ueberblick/ui/components/admin';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { propertyColumns, type ColumnsInput } from '../data/columns';
  import { correctionValues, createRowSaver, type CorrectTexts } from '../data/correct';
  import { createFeatureSource, type SourceError } from '../data/source.svelte';
  import type { TablesApi } from './api';

  type TypeDef = ColumnsInput['type'];
  let {
    locale,
    project,
    table,
    type,
    names,
    roles = [],
    api,
    reloadToken = 0,
    onManageColumns,
  }: {
    locale: Locale;
    project: string;
    table: string;
    /** The table as deployed: the list API reads the deployed config. */
    type: TypeDef;
    names: Readonly<Record<string, string>>;
    /** The project's roles: a `role` column shows the label, not the key. */
    roles?: readonly { readonly key: string; readonly label: string }[];
    api: TablesApi;
    /** Changes when the page asks for a re-read ("Aktualisieren"). */
    reloadToken?: number;
    onManageColumns: () => void;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const input = $derived<ColumnsInput>({
    type,
    locale,
    names,
    actors: { system: t('data_actor_system'), importBy: (admin) => t('data_actor_import', { admin }) },
    roleLabels: Object.fromEntries(roles.map((r) => [r.key, { [locale]: r.label }])),
    labels: {
      status: '',
      stage: '',
      createdBy: '',
      location: '',
      created: '',
      yes: t('data_yes'),
      no: t('data_no'),
    },
  });
  const fail = (kind: SourceError): void =>
    void toast.error(t(kind === 'values' ? 'data_values_error' : 'data_load_error'));
  const source = createFeatureSource({
    project: untrack(() => project),
    type: untrack(() => table),
    input: () => input,
    fetch: (url, init) => fetch(url, init),
    onError: fail,
  });
  onDestroy(() => source.destroy());

  let lastToken = untrack(() => reloadToken);
  $effect(() => {
    if (reloadToken === lastToken) return;
    lastToken = reloadToken;
    source.reload();
  });

  // One column per property in the type's order: the first is the Hauptspalte (Q15). v3 showed only these columns.
  const columns = $derived<TableColumn[]>(propertyColumns(type, locale, input.roleLabels));

  const texts: CorrectTexts = {
    stale: t('data_correct_stale'),
    failed: t('data_correct_failed'),
    refused: (property, reason) => t('data_correct_refused', { property, reason }),
    label: (key) => columns.find((c) => c.key === key)?.label ?? key,
  };
  const saveRow = createRowSaver({
    fetch: (url, init) => fetch(url, init),
    project: untrack(() => project),
    type: () => type,
    texts,
    rows: () => source.rows,
    refresh: (id) => source.refreshRow(id),
  });

  /** The inline add row (v3 `onCreateRow`): one `$create` run; a refusal stays on the row and shows as a toast. */
  async function add(values: TableRow): Promise<void> {
    const result = await api.addRow(table, correctionValues(type, values));
    if (!result.ok) {
      toast.error(result.message || t('tbl_row_create_error'));
      throw new CellRefusal(result.message);
    }
    toast.success(t('tbl_row_created'));
    source.reload();
  }

  const requiredKeys = $derived(
    Object.entries(type.properties)
      .filter(([, p]) => p.required === true)
      .map(([key]) => key),
  );
  /** v3 `getDefaultValues`: the columns' defaults fill the add row. */
  const defaults = (): TableRow => {
    const out: TableRow = {};
    for (const [key, p] of Object.entries(type.properties))
      if (p.default !== undefined) out[key] = p.type === 'select' ? [String(p.default)] : p.default;
    return out;
  };

  let deleteId = $state<string | null>(null);
  let deleteOpen = $state(false);
  async function remove(): Promise<void> {
    const id = deleteId;
    if (id === null) return;
    const result = await api.deleteRow(id);
    deleteOpen = false;
    deleteId = null;
    if (!result.ok) {
      toast.error(result.message || t('tbl_row_delete_error'));
      return;
    }
    toast.success(t('tbl_row_deleted'));
    source.reload();
  }
</script>

<BaseTable
  rows={source.rows}
  {columns}
  {locale}
  selectable
  shiftSelect
  showToolbar
  showEditMode
  onRowSave={saveRow}
  onAdd={add}
  addRow={{ requiredKeys, defaultValues: defaults }}
  columnManagement={{ label: t('tbl_add_column'), onOpen: onManageColumns }}
  onDelete={(ids) => {
    deleteId = ids[0] ?? null;
    deleteOpen = deleteId !== null;
  }}
  rowMenu={{ header: t('tbl_actions') }}
  onQueryChange={(q) => source.query(q)}
  onReachEnd={source.loadMore}
  filterValues={source.filterValues}
  loading={source.loading}
  loadingMore={source.loadingMore}
  loadingLabel={t('data_loading')}
  emptyMessage={t('tbl_row_empty')}
/>

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('tbl_row_delete')}</AlertDialog.Title>
      <AlertDialog.Description>{t('tbl_row_delete_confirm')}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{t('tbl_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void remove()}
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
        data-testid="row-delete-confirm"
      >
        {t('tbl_delete_action')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
