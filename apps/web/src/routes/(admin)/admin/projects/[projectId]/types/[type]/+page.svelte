<script lang="ts">
  // The data page of one Objektart (v3 `workflows/[workflowId]/+page.svelte`): header (name, "Builder", "Aktualisieren")
  // above the table of its Objekte. Rows come from the admin feature list API, page by page (`lib/admin/data`).
  import { deserialize } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';
  import { ICON_BADGES, ICON_TEMPLATES, checkLook, droppedFor, templateIcon } from '@ueberblick/builder';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { createMenuApi } from '../../../../../../../lib/admin/data/menu-api';
  import DeleteTypeDialog from '../../../../../../../lib/admin/data/DeleteTypeDialog.svelte';
  import ImportTypeDialog from '../../../../../../../lib/admin/data/ImportTypeDialog.svelte';
  import { createHeaderApi } from '../../../../../../../lib/admin/data/header-api';
  import type { HeaderCall, HeaderResult } from '../../../../../../../lib/admin/data/header-types';
  import type { CopyDone } from '../../../../../../../lib/admin/data/menu-types';
  import DataHeader from '../../../../../../../lib/admin/data/DataHeader.svelte';
  import DataTable from '../../../../../../../lib/admin/data/DataTable.svelte';
  import { detailHref } from '../../../../../../../lib/admin/data/table-state';
  import { createIconsApi } from '../../../../../../../lib/admin/icons/api';
  import IconsDialog from '../../../../../../../lib/admin/icons/IconsDialog.svelte';
  import type { IconsKit, IconsState } from '../../../../../../../lib/admin/icons/types';
  import { draftStatus, notifyDraftChanged } from '../../../../../../../lib/admin/draft/status-store.svelte';
  import CsvImportDialog from '../../../../../../../lib/admin/import/CsvImportDialog.svelte';
  import { adminMessage } from '../../../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(data.locale, key);

  // The name is the draft's (as the sidebar shows it); the table reads the type as deployed.
  const name = $derived(data.types.find((x) => x.key === data.key)?.label ?? data.key);
  // The description is the draft's too: the header reads the draft, the table the deployed type.
  const description = $derived(data.header?.description ?? '');
  let reloadToken = $state(0);
  // v3's "Icons" button and designer (`+page.svelte:1001`, `openIconDesigner`): one draft edit per change.
  // The route hands the builder's icon functions to the dialog: code outside the admin routes never imports the builder.
  const iconsKit: IconsKit = {
    templates: ICON_TEMPLATES,
    badges: ICON_BADGES,
    templateIcon,
    checkLook,
    droppedFor,
  };
  let iconsOpen = $state(false);
  let icons = $state<IconsState | null>(null);
  $effect(() => {
    icons = data.icons;
  });
  const iconsApi = $derived(
    createIconsApi({
      project: data.project,
      type: data.key,
      language: data.locale === 'en' ? 'en' : 'de',
      fetch,
      deserialize,
      fallback: t('icons_err_failed'),
    }),
  );
  // The header's edits (v3 `updateMeta`): one draft edit each; the shell's bar and the page follow.
  const headerApi = $derived(
    createHeaderApi({
      project: data.project,
      type: data.key,
      language: data.locale === 'en' ? 'en' : 'de',
      fetch,
      deserialize,
      fallback: t('data_header_failed'),
    }),
  );
  async function headerCall(call: HeaderCall): Promise<HeaderResult> {
    const result = await headerApi.call(call);
    if (!result.ok) return result;
    if (call.action === 'map') toast.success(t('data_type_changed'));
    notifyDraftChanged();
    await invalidateAll();
    return result;
  }
  // The ⋮ menu (v3 `+page.svelte:657-800`): the copy or the removal is one draft edit; the shell's bar follows.
  const menuApi = $derived(
    createMenuApi({
      project: data.project,
      type: data.key,
      language: data.locale === 'en' ? 'en' : 'de',
      fetch,
      deserialize,
      fallback: t('data_header_failed'),
    }),
  );
  let importTypeOpen = $state(false);
  let deleteOpen = $state(false);
  let duplicating = $state(false);
  const projectHref = $derived(`/admin/projects/${data.project}`);
  /** The copy is in the draft: say what it left out, then open it (v3 `goto` of the new workflow). */
  async function openCopy(copy: CopyDone): Promise<void> {
    for (const note of copy.notes) toast.warning(note);
    notifyDraftChanged();
    await goto(`${projectHref}/types/${copy.key}`, { invalidateAll: true });
  }
  async function duplicate(): Promise<void> {
    if (duplicating) return;
    duplicating = true;
    const r = await menuApi.call({ action: 'duplicate' });
    duplicating = false;
    if (!r.ok) return void toast.error(r.message);
    if (r.answer.kind !== 'copy') return;
    toast.success(t('data_menu_duplicate_success'));
    await openCopy(r.answer.copy);
  }
  /** The type is out of the draft: v3 went to the project's settings (its list of Objektarten). */
  async function removed(notes: readonly string[]): Promise<void> {
    for (const note of notes) toast.warning(note);
    notifyDraftChanged();
    await goto(`${projectHref}/settings`, { invalidateAll: true });
  }
  /** v3's "Aktualisieren" (`invalidateAll`): the roster and the type again, then the first page of rows. */
  async function refresh(): Promise<void> {
    await invalidateAll();
    reloadToken += 1;
  }
  // The CSV wizard (S3-22). Publishing from its last step clears the shell's bar and brings the deployed type in.
  let importOpen = $state(false);
  async function afterPublish(): Promise<void> {
    await draftStatus.refresh(data.project);
    await invalidateAll();
  }
</script>

<svelte:head><title>{name} - {t('product')}</title></svelte:head>

<div class="flex h-full min-h-0 w-full min-w-0 flex-col gap-4">
  <DataHeader
    {name}
    {description}
    builderHref="/admin/projects/{data.project}/types/{data.key}/builder"
    builderLabel={t('data_builder')}
    refreshLabel={t('data_refresh')}
    onRefresh={refresh}
    iconsLabel={t('data_icons')}
    onIcons={icons ? () => (iconsOpen = true) : undefined}
    importLabel={t('import_button')}
    onImport={() => (importOpen = true)}
    header={data.header ?? undefined}
    locale={data.locale}
    onCall={data.header ? headerCall : undefined}
    menu={data.header
      ? {
          busy: duplicating,
          onDuplicate: () => void duplicate(),
          onImport: () => (importTypeOpen = true),
          onDelete: () => (deleteOpen = true),
        }
      : undefined}
  />
  <ImportTypeDialog bind:open={importTypeOpen} locale={data.locale} api={menuApi} onImported={openCopy} />
  <DeleteTypeDialog bind:open={deleteOpen} locale={data.locale} {name} api={menuApi} onRemoved={removed} />
  <CsvImportDialog
    bind:open={importOpen}
    locale={data.locale}
    project={data.project}
    type={data.key}
    setup={data.importing.setup}
    published={data.importing.published}
    onpublished={afterPublish}
    ondone={() => void refresh()}
  />
  {#if icons}
    <IconsDialog
      bind:open={iconsOpen}
      locale={data.locale}
      {name}
      kit={iconsKit}
      {icons}
      onstate={(next) => (icons = next)}
      api={iconsApi}
      onchanged={notifyDraftChanged}
    />
  {/if}
  {#if data.type}
    {#key data.key}
      <DataTable
        locale={data.locale}
        project={data.project}
        typeKey={data.key}
        type={data.type}
        names={data.names}
        roleLabels={data.roleLabels}
        basemap={data.basemap}
        {reloadToken}
        onOpen={(id) => void goto(detailHref(data.project, data.key, id))}
      />
    {/key}
  {:else}
    <div
      class="flex flex-1 items-start justify-center rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground"
    >
      <div class="flex flex-col items-center gap-2">
        <p>{t('data_empty')}</p>
        <p class="text-xs">{t('data_unpublished')}</p>
      </div>
    </div>
  {/if}
</div>
