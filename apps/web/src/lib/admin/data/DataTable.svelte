<script lang="ts">
  // v3's table of the data page (`workflows/[workflowId]/+page.svelte:1057-1074`): BaseTable with v3's columns over the
  // admin feature list API. The cells that are not plain text (Status badge, Standort hover card, files) are the
  // page's own snippets, as in v3 (`statusCellRenderer`, `locationCellRenderer`, `fileCellRenderer`).
  import { onDestroy, untrack } from 'svelte';
  import { BaseTable, type TableColumn, type TableRow } from '@ueberblick/ui/components/admin';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { buildColumns, LIFECYCLE_KEY, LOCATION_KEY, lifecycleLabel, type ColumnsInput } from './columns';
  import { createRowSaver, type CorrectTexts } from './correct';
  import FileCell from './FileCell.svelte';
  import ImageLightbox from './ImageLightbox.svelte';
  import type { PreviewBasemap } from './tile-underlay';
  import GeometryPreview from './GeometryPreview.svelte';
  import { createFeatureSource, type SourceError } from './source.svelte';
  import { loadQuery, saveQuery } from './table-state';

  type TypeDef = ColumnsInput['type'];
  let {
    locale,
    project,
    typeKey,
    type,
    names,
    roleLabels = {},
    reloadToken = 0,
    basemap = null,
    onOpen,
  }: {
    locale: Locale;
    project: string;
    typeKey: string;
    type: TypeDef;
    names: Readonly<Record<string, string>>;
    /** Role key to its labels (`role` properties). */
    roleLabels?: ColumnsInput['roleLabels'];
    /** Changes when the page asks for a re-read ("Aktualisieren"). */
    reloadToken?: number;
    /** The project's base layer as plain tiles for the Standort preview; null draws the shape alone. */
    basemap?: PreviewBasemap | null;
    /** A click on a row opens that Objekt (v3: `goto` to its page); the page decides where. */
    onOpen?: (id: string) => void;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const input = $derived<ColumnsInput>({
    type,
    locale,
    names,
    actors: { system: t('data_actor_system'), importBy: (admin) => t('data_actor_import', { admin }) },
    roleLabels,
    labels: {
      status: t('data_col_status'),
      stage: t('data_col_stage'),
      createdBy: t('data_col_created_by'),
      location: t('data_col_location'),
      created: t('data_col_created'),
      yes: t('data_yes'),
      no: t('data_no'),
    },
  });

  const fail = (kind: SourceError): void =>
    void toast.error(t(kind === 'values' ? 'data_values_error' : 'data_load_error'));
  // One source per page of one Objektart (the page keys this component by the type).
  const source = createFeatureSource({
    project: untrack(() => project),
    type: untrack(() => typeKey),
    input: () => input,
    fetch: (url, init) => fetch(url, init),
    onError: fail,
  });
  onDestroy(() => source.destroy());
  // The table's query is kept for the detail page's "Zurück" (see table-state.ts); a first build starts empty.
  const initialQuery = loadQuery(
    untrack(() => project),
    untrack(() => typeKey),
  );

  let lastToken = untrack(() => reloadToken);
  $effect(() => {
    if (reloadToken === lastToken) return;
    lastToken = reloadToken;
    source.reload();
  });

  // Bearbeitungsmodus (v3's switch) collects the edits of a row; its check sends them as ONE Admin-Korrektur run.
  const texts: CorrectTexts = {
    stale: t('data_correct_stale'),
    failed: t('data_correct_failed'),
    refused: (property, reason) => t('data_correct_refused', { property, reason }),
    label: (key) => base.find((c) => c.key === key)?.label ?? key,
  };
  const saveRow = createRowSaver({
    fetch: (url, init) => fetch(url, init),
    project: untrack(() => project),
    type: () => type,
    texts,
    rows: () => source.rows,
    refresh: (id) => source.refreshRow(id),
  });

  let lightbox = $state<{ url: string; name: string } | null>(null);

  const base = $derived(buildColumns(input));
  const stageLabels = $derived(
    new Map(
      (base.find((c) => c.key === type.process?.property)?.options ?? []).map((o) => [o.value, o.label]),
    ),
  );

  // Read when the table renders, after the snippets below exist.
  const columns = $derived.by<TableColumn[]>(() => {
    const cells: Readonly<Record<string, TableColumn['cell']>> = {
      [LIFECYCLE_KEY]: lifecycleCell,
      [LOCATION_KEY]: locationCell,
    };
    const stage = type.process?.property;
    return base.map((c) => {
      if (c.key === stage) return { ...c, kind: 'custom' as const, cell: stageCell };
      const cell = cells[c.key] ?? (type.properties[c.key]?.type === 'file' ? fileCell : undefined);
      return cell ? { ...c, cell } : c;
    });
  });
</script>

{#snippet lifecycleCell({ value }: { value: unknown })}
  {@const state = String(value)}
  <Badge variant={state === 'active' ? 'default' : state === 'completed' ? 'secondary' : 'outline'}>
    {lifecycleLabel(state, locale)}
  </Badge>
{/snippet}

{#snippet locationCell({ value, row }: { value: unknown; row: Record<string, unknown> })}
  {@const label = String(value ?? '')}
  {#if label !== ''}
    <GeometryPreview
      {project}
      type={typeKey}
      id={String(row.id)}
      {label}
      alt={t('data_preview_alt')}
      failed={t('data_preview_error')}
      {basemap}
    />
  {:else}
    <span class="text-xs text-muted-foreground">—</span>
  {/if}
{/snippet}

{#snippet stageCell({ value }: { value: unknown })}
  {@const key = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')}
  {@const label = stageLabels.get(key) ?? key}
  {#if key !== ''}
    <Badge variant="secondary" class="text-xs" title={t('data_stage_readonly')} data-testid="stage-cell"
      >{label}</Badge
    >
  {:else}
    <span class="text-xs text-muted-foreground">—</span>
  {/if}
{/snippet}

{#snippet fileCell({ value }: { value: unknown })}
  <FileCell {project} {value} onImage={(url, name) => (lightbox = { url, name })} />
{/snippet}

<BaseTable
  rows={source.rows}
  {columns}
  {locale}
  selectable
  shiftSelect
  showToolbar
  showEditMode
  onRowSave={saveRow}
  {...initialQuery === undefined ? {} : { initialQuery }}
  onQueryChange={(q) => {
    saveQuery(project, typeKey, q);
    source.query(q);
  }}
  onRowClick={(row) => onOpen?.(String(row.id))}
  onReachEnd={source.loadMore}
  filterValues={source.filterValues}
  loading={source.loading}
  loadingMore={source.loadingMore}
  loadingLabel={t('data_loading')}
  emptyMessage={t('data_empty')}
  emptySubMessage={t('data_empty_sub')}
/>

<ImageLightbox image={lightbox} fallbackTitle={t('data_preview_alt')} onClose={() => (lightbox = null)} />
