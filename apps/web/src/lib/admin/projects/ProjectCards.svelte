<script lang="ts">
  // The Projekte page (v3 `admin/projects/+page.svelte:428-585`): title, the split button "Projekt erstellen" with the
  // chevron menu ("Aus Datei importieren", "Gesamtes Projekt importieren (ZIP)"), one card per project with name,
  // description (or "Erstellt: <Datum>"), the ⋮ menu and "Projekt öffnen", and v3's empty state. v3's "Fork as draft"
  // is replaced by the one draft per project (WP-320). The ZIP, CSV and GeoPackage exports and the ZIP import are S3-8.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import FolderArchive from '@lucide/svelte/icons/folder-archive';
  import Upload from '@lucide/svelte/icons/upload';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Card from '@ueberblick/ui/components/ui/card';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import ArchiveImportDialog from './ArchiveImportDialog.svelte';
  import { exportUrl, fetchDownload, saveBlob, type ExportKind } from './archive-client';
  import ImportProblemsDialog from './ImportProblemsDialog.svelte';
  import { exportSchema, importProjectFile, schemaFilename, type FileProblem } from './menu-client';
  import ProjectMenu from './ProjectMenu.svelte';
  import PublishTemplateDialog from './PublishTemplateDialog.svelte';

  interface ProjectCard {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly createdAt: string;
    readonly published?: boolean;
  }
  interface Listing {
    readonly key: string;
    readonly version: string;
  }

  let {
    locale,
    projects,
    templates = [],
    reload = async () => undefined,
  }: {
    locale: Locale;
    projects: readonly ProjectCard[];
    templates?: readonly Listing[];
    /** Re-reads the list (the route passes `invalidateAll`). */
    reload?: () => Promise<void>;
  } = $props();
  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const date = (iso: string): string => new Date(iso).toLocaleDateString(locale);

  let fileInput: HTMLInputElement;
  let archiveInput: HTMLInputElement;
  let archiveFile = $state<File | null>(null);
  let archiveOpen = $state(false);
  let archiveBusy = $state(false);
  let importing = $state(false);
  // A running export ignores a second click; the menu item stays enabled so the menu closes on the click (bits-ui
  // checks `disabled` after the handler). The ZIP, CSV and GeoPackage exports do the same (v3 `exportingArchive`).
  let exporting = false;
  const busy = new Set<ExportKind>();
  let publishFor = $state<ProjectCard | null>(null);
  let publishOpen = $state(false);
  let problems = $state<readonly FileProblem[]>([]);
  let problemsFile = $state('');
  let problemsOpen = $state(false);

  /** v3 `handleExport` (`+page.svelte:69-98`): fetch, save as a file, toast. The file is YAML here (v4's project file). */
  async function handleExport(project: ProjectCard): Promise<void> {
    if (exporting) return;
    exporting = true;
    const r = await exportSchema(project.key);
    exporting = false;
    if (!r.ok) {
      toast.error(t('projects_export_error'));
      return;
    }
    const url = URL.createObjectURL(new Blob([r.text], { type: 'application/yaml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = schemaFilename(project.name);
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('projects_export_success'));
  }

  const EXPORTS = {
    zip: {
      suffix: '.zip',
      success: 'projects_export_archive_success',
      error: 'projects_export_archive_error',
    },
    csv: { suffix: '-data.zip', success: 'projects_export_csv_success', error: 'projects_export_csv_error' },
    gpkg: { suffix: '.gpkg', success: 'projects_export_gpkg_success', error: 'projects_export_gpkg_error' },
  } as const satisfies Record<ExportKind, { suffix: string; success: AdminKey; error: AdminKey }>;

  /** v3 `handleExportArchive` and `handleExportCsvOnly` (`+page.svelte:193-249`): fetch, save as a file, toast. */
  async function handleDownload(kind: ExportKind, project: ProjectCard): Promise<void> {
    if (busy.has(kind)) return;
    busy.add(kind);
    const got = await fetchDownload(
      exportUrl(project.key, kind),
      `${project.name.toLowerCase().replace(/\s+/g, '-')}${EXPORTS[kind].suffix}`,
    );
    busy.delete(kind);
    if (!got.ok) {
      toast.error(t(EXPORTS[kind].error));
      return;
    }
    saveBlob(got.blob, got.filename);
    // The project ZIP holds the login tokens of the participants (A-046): the toast says it stays confidential.
    if (kind === 'zip')
      toast.success(t(EXPORTS.zip.success), { description: t('projects_export_archive_sensitive') });
    else toast.success(t(EXPORTS[kind].success));
  }

  function onArchiveSelected(e: Event & { currentTarget: HTMLInputElement }): void {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    archiveFile = file;
    archiveOpen = true;
  }

  /** v3 `handleImport` (`+page.svelte:100-125`): upload, toast, reload; the problems of a refused file are listed. */
  async function handleImport(file: File): Promise<void> {
    if (importing) return;
    importing = true;
    const r = await importProjectFile(file);
    importing = false;
    if (r.ok) {
      await reload();
      toast.success(t('projects_import_success'));
    } else if (r.problems.length > 0) {
      problems = r.problems;
      problemsFile = file.name;
      problemsOpen = true;
    } else toast.error(t('projects_import_error'));
  }

  function onFileSelected(e: Event & { currentTarget: HTMLInputElement }): void {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) void handleImport(file);
  }

  function openPublish(project: ProjectCard): void {
    publishFor = project;
    publishOpen = true;
  }
</script>

<input
  bind:this={fileInput}
  type="file"
  accept=".yaml,.yml,.json"
  class="hidden"
  data-testid="import-file"
  onchange={onFileSelected}
/>

<input
  bind:this={archiveInput}
  type="file"
  accept=".zip"
  class="hidden"
  data-testid="import-archive-file"
  onchange={onArchiveSelected}
/>

<div class="container mx-auto p-6">
  <div class="mb-6 flex items-center justify-between gap-3">
    <h1 class="text-3xl font-bold">{t('nav_projects')}</h1>
    <div class="flex">
      <Button href="/admin/projects/new" class="rounded-r-none">{t('projects_create')}</Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              class="rounded-l-none border-l border-l-primary-foreground/20 px-2"
              disabled={importing}
              aria-label={t('projects_import_more')}
            >
              <ChevronDown class="size-4" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item onclick={() => fileInput.click()}>
            <Upload class="mr-2 size-4" />
            {t('projects_import_from_file')}
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => archiveInput.click()} disabled={archiveBusy}>
            <FolderArchive class="mr-2 size-4" />
            {t('projects_import_archive')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>

  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    {#each projects as project (project.key)}
      <Card.Root>
        <Card.Header>
          <div class="flex items-start justify-between">
            <div class="min-w-0">
              <Card.Title>{project.name}</Card.Title>
              {#if project.description}
                <Card.Description>{project.description}</Card.Description>
              {:else if project.createdAt}
                <Card.Description>{t('projects_created')}: {date(project.createdAt)}</Card.Description>
              {/if}
            </div>
            <ProjectMenu
              {locale}
              name={project.name}
              published={project.published ?? false}
              onexport={() => handleExport(project)}
              onexportarchive={() => handleDownload('zip', project)}
              onexportcsv={() => handleDownload('csv', project)}
              onexportgpkg={() => handleDownload('gpkg', project)}
              onpublish={() => openPublish(project)}
            />
          </div>
        </Card.Header>
        <Card.Content>
          <Button href="/admin/projects/{project.key}/participants" class="w-full">
            {t('projects_open')}
          </Button>
        </Card.Content>
      </Card.Root>
    {:else}
      <div class="col-span-full text-center">
        <p class="mb-4 text-muted-foreground">{t('projects_empty')}</p>
        <Button href="/admin/projects/new">{t('projects_create')}</Button>
      </div>
    {/each}
  </div>
</div>

{#if publishFor}
  <PublishTemplateDialog
    bind:open={publishOpen}
    {locale}
    project={publishFor}
    {templates}
    onpublished={(key, version) => {
      toast.success(t('template_publish_success', { key, version }));
      void reload();
    }}
  />
{/if}
<ArchiveImportDialog
  bind:open={archiveOpen}
  bind:busy={archiveBusy}
  {locale}
  file={archiveFile}
  onimported={(renewed) => {
    if (renewed > 0)
      toast.success(t('projects_import_archive_success'), {
        description: t('projects_import_archive_renewed', { n: renewed }),
      });
    else toast.success(t('projects_import_archive_success'));
    void reload();
  }}
  onfailed={(message) => {
    toast.error(message);
    void reload();
  }}
/>
<ImportProblemsDialog bind:open={problemsOpen} {locale} fileName={problemsFile} {problems} />
