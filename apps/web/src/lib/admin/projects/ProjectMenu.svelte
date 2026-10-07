<script lang="ts">
  // The ⋮ menu of a project card (v3 `+page.svelte:478-540`: ghost icon button, items with a leading icon, in v3's
  // order: "Schema exportieren", "Gesamtes Projekt exportieren (ZIP)", "Daten exportieren (CSV)"). "GeoPackage
  // exportieren" follows the CSV item (WP-384). "Als Vorlage veröffentlichen" (Q11) sits below a separator, where v3
  // had "Fork as draft". The data exports and the template need a published project (no data before the first
  // publish, Q17), so they are disabled with their reason; the ZIP works from the first draft on (it carries the file).
  import Download from '@lucide/svelte/icons/download';
  import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
  import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import MapIcon from '@lucide/svelte/icons/map';
  import Package from '@lucide/svelte/icons/package';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';

  let {
    locale,
    name,
    published,
    onexport,
    onexportarchive,
    onexportcsv,
    onexportgpkg,
    onpublish,
  }: {
    locale: Locale;
    name: string;
    published: boolean;
    onexport: () => void;
    onexportarchive: () => void;
    onexportcsv: () => void;
    onexportgpkg: () => void;
    onpublish: () => void;
  } = $props();
  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon-sm" aria-label={t('projects_menu', { name })}>
        <EllipsisVertical class="size-4" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Item onclick={onexport}>
      <Download class="mr-2 size-4" />
      {t('projects_export_schema')}
    </DropdownMenu.Item>
    <!-- The file holds the participants' login credentials (A-046, owner A7): the tooltip says so where it is chosen, the toast when it is saved. -->
    <DropdownMenu.Item onclick={onexportarchive} title={t('projects_export_archive_sensitive')}>
      <Package class="mr-2 size-4" />
      {t('projects_export_archive')}
    </DropdownMenu.Item>
    <DropdownMenu.Item
      onclick={onexportcsv}
      disabled={!published}
      title={published ? undefined : t('projects_export_needs_publish')}
    >
      <FileSpreadsheet class="mr-2 size-4" />
      {t('projects_export_csv')}
    </DropdownMenu.Item>
    <DropdownMenu.Item
      onclick={onexportgpkg}
      disabled={!published}
      title={published ? undefined : t('projects_export_needs_publish')}
    >
      <MapIcon class="mr-2 size-4" />
      {t('projects_export_gpkg')}
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item
      onclick={onpublish}
      disabled={!published}
      title={published ? undefined : t('projects_publish_template_unpublished')}
    >
      <LayoutTemplate class="mr-2 size-4" />
      {t('projects_publish_template')}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
