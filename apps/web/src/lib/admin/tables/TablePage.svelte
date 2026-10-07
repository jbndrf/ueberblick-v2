<script lang="ts">
  // The page of one table (v3 `custom-tables/[tableId]/+page.svelte`): the entity header (name, description and roles edited
  // in place, "Aktualisieren"), the table with its rows, and the column manager behind the "+" of the last header. The
  // route passes the load data, the api and the two things only it can do: reload and tell the shell the draft changed.
  // v3's "CSV importieren" (`custom-tables/[tableId]/+page.svelte:237`, before "Aktualisieren") opens the shared wizard
  // (`../import/CsvImportDialog.svelte`): a Tabelle's rows are `$create` runs (owner A8, WP-433).
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Upload from '@lucide/svelte/icons/upload';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import CsvImportDialog from '../import/CsvImportDialog.svelte';
  import type { ImportSetupData } from '../import/setup.server';
  import type { ColumnsInput } from '../data/columns';
  import type { CallResult } from '../participants/types';
  import type { TablesApi } from './api';
  import type { RoleChoice } from './load.server';
  import type { TableColumnDef, TableSummary } from './model';
  import TableColumnManager from './TableColumnManager.svelte';
  import TableGrid from './TableGrid.svelte';
  import type { HeaderResult } from '../data/header-types';
  import TypeHeaderFields from '../data/TypeHeaderFields.svelte';
  import type { ColumnSpec } from './types';

  let {
    data,
    locale,
    api,
    reload,
    draftChanged,
  }: {
    data: {
      project: string;
      key: string;
      summary: TableSummary;
      columns: readonly TableColumnDef[];
      roles: readonly RoleChoice[];
      deployed: ColumnsInput['type'] | null;
      names: Readonly<Record<string, string>>;
      /** The CSV wizard's targets: the table's columns, and whether the table is in the deployed version. */
      importing: ImportSetupData;
    };
    locale: Locale;
    api: TablesApi;
    reload: () => Promise<void>;
    /** The draft changed: the shell's publish bar re-reads its status. */
    draftChanged: () => void;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let reloadToken = $state(0);
  let managerOpen = $state(false);
  let importOpen = $state(false);

  /** v3 `invalidateAll` on "Aktualisieren": the table and its columns again, then the first page of rows. */
  async function refresh(): Promise<void> {
    await reload();
    reloadToken += 1;
  }

  /** One draft edit of the header: the refusal goes back to the field it belongs to; on success the shell's bar and the page follow. */
  async function settle(result: CallResult<unknown>): Promise<HeaderResult> {
    if (!result.ok) return { ok: false, message: result.message || t('tbl_update_error') };
    draftChanged();
    await reload();
    return { ok: true };
  }

  async function saveColumns(next: readonly ColumnSpec[]): Promise<CallResult<null>> {
    const result = await api.saveColumns(data.key, next);
    if (result.ok) {
      toast.success(t('tbl_cols_update_ok'));
      draftChanged();
      await reload();
    } else toast.error(result.message || t('tbl_cols_update_error'));
    return result;
  }
</script>

<div class="flex h-[calc(100svh-4rem)] min-h-[28rem] w-full min-w-0 flex-col gap-4">
  <TypeHeaderFields
    {locale}
    prefix="table"
    name={data.summary.label}
    description={data.summary.description}
    audience={data.summary.audience}
    roles={data.roles}
    onName={async (name) => settle(await api.update(data.key, { name }))}
    onDescription={async (description) => settle(await api.update(data.key, { description }))}
    onRoles={async (roles) => settle(await api.update(data.key, { roles }))}
  >
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={() => (importOpen = true)} data-testid="csv-import-button">
        <Upload class="mr-2 h-4 w-4" />
        {t('import_button')}
      </Button>
      <Button variant="outline" size="sm" onclick={() => void refresh()}>
        <RefreshCw class="mr-2 h-4 w-4" />
        {t('tbl_refresh')}
      </Button>
    {/snippet}
  </TypeHeaderFields>

  {#if data.deployed}
    {#key data.key}
      <TableGrid
        {locale}
        project={data.project}
        table={data.key}
        type={data.deployed}
        names={data.names}
        roles={data.roles}
        {api}
        {reloadToken}
        onManageColumns={() => (managerOpen = true)}
      />
    {/key}
  {:else}
    <div
      class="flex flex-1 items-start justify-center rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground"
      data-testid="table-unpublished"
    >
      <div class="flex flex-col items-center gap-3">
        <p>{t('tbl_row_empty')}</p>
        <p class="text-xs">{t('tbl_unpublished')}</p>
        <Button variant="outline" size="sm" onclick={() => (managerOpen = true)}>
          <Plus class="mr-2 h-4 w-4" />
          {t('tbl_add_column')}
        </Button>
      </div>
    </div>
  {/if}
</div>

<CsvImportDialog
  bind:open={importOpen}
  {locale}
  project={data.project}
  type={data.key}
  setup={data.importing.setup}
  published={data.importing.published}
  onpublished={async () => {
    draftChanged();
    await refresh();
  }}
  ondone={() => void refresh()}
/>

<TableColumnManager bind:open={managerOpen} {locale} columns={data.columns} onsave={saveColumns} />
