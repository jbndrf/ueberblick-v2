<script lang="ts">
  // The Objekt's page (v3 `instances/[id]/+page.svelte`): header, Standort pane, tabs Daten and Aktivität. v3's third
  // tab, Protokolle, is each Aktivität entry's "Protokoll öffnen" (owner A3, WP-372). The history arrives a page at a time ("Mehr laden").
  import { untrack } from 'svelte';
  import type { LocalizedString } from '@ueberblick/core';
  import type { HistoryPage, HistoryRun } from '@ueberblick/server';
  import * as Tabs from '@ueberblick/ui/components/ui/tabs';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { actorName } from '../actor-names';
  import { lifecycleLabel } from '../data/columns';
  import ImageLightbox from '../data/ImageLightbox.svelte';
  import type { PreviewBasemap } from '../data/tile-underlay';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import ActivityTab from './ActivityTab.svelte';
  import DataTab from './DataTab.svelte';
  import FeatureHeader, { type HeaderField } from './FeatureHeader.svelte';
  import LocationPane from './LocationPane.svelte';
  import { buildDetail, groupRows, type ApiRow, type TaskDefs, type TypeDef } from './model';
  import { nextHistory } from './history';

  let {
    locale,
    project,
    typeKey,
    type,
    tasks,
    row,
    history,
    names,
    roleLabels = {},
    basemap,
    backHref,
  }: {
    locale: 'de' | 'en';
    project: string;
    typeKey: string;
    type: TypeDef;
    tasks: TaskDefs;
    row: ApiRow;
    history: HistoryPage;
    names: Readonly<Record<string, string>>;
    roleLabels?: Readonly<Record<string, LocalizedString>>;
    basemap: PreviewBasemap | null;
    backHref: string;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const actors = {
    system: t('data_actor_system'),
    importBy: (admin: string) => t('data_actor_import', { admin }),
  };

  let runs = $state<readonly HistoryRun[]>(untrack(() => history.runs));
  let featureLabels = $state<Readonly<Record<string, string>>>(untrack(() => history.labels));
  let next = $state<string | null>(untrack(() => history.next));
  let loadingMore = $state(false);
  let lightbox = $state<{ url: string; name: string } | null>(null);

  const id = $derived(String(row['$id']));
  const detail = $derived(
    buildDetail({ typeKey, type, tasks, row, runs, names, actors, roleLabels, featureLabels, locale }),
  );
  const groups = $derived(groupRows(detail.sheet.rows, type, locale));

  async function more(): Promise<void> {
    if (next === null || loadingMore) return;
    loadingMore = true;
    const page = await nextHistory(project, id, next, (url) => fetch(url));
    loadingMore = false;
    if (page === null) return void toast.error(t('feature_activity_load_error'));
    runs = [...runs, ...page.runs];
    featureLabels = { ...featureLabels, ...page.labels };
    next = page.next;
  }

  const stamp = (v: unknown): string => {
    if (typeof v !== 'string' || v === '') return t('feature_no_value');
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString(locale);
  };
  const stageKey = $derived(type.process?.property);
  const lifecycle = $derived(String(row['$lifecycle']));
  const createdBy = $derived(String(row['$created_by'] ?? ''));
  const fields = $derived<HeaderField[]>([
    ...(stageKey === undefined
      ? []
      : [
          {
            key: 'stage',
            label: t('feature_header_stage'),
            value: detail.sheet.rows.find((r) => r.key === stageKey)?.text ?? t('feature_no_value'),
          },
        ]),
    {
      key: 'status',
      label: t('feature_header_status'),
      value: lifecycleLabel(lifecycle, locale),
      badge: lifecycle === 'active' ? 'default' : lifecycle === 'completed' ? 'secondary' : 'outline',
    },
    {
      key: 'created-by',
      label: t('feature_header_created_by'),
      value: createdBy === '' ? t('feature_no_value') : actorName(names, createdBy, actors),
    },
    { key: 'created', label: t('feature_header_created'), value: stamp(row['$created_at']) },
    { key: 'changed', label: t('feature_header_changed'), value: stamp(row['$changed_at']) },
  ]);
  const lon = $derived(typeof row['lon'] === 'number' ? row['lon'] : null);
  const lat = $derived(typeof row['lat'] === 'number' ? row['lat'] : null);
</script>

<div class="mx-auto max-w-4xl space-y-6">
  <FeatureHeader
    {backHref}
    backLabel={t('feature_back')}
    typeLabel={detail.sheet.typeLabel}
    name={detail.sheet.title}
    {fields}
  />

  {#if type.geometry !== undefined}
    <LocationPane
      {project}
      type={typeKey}
      {id}
      {lon}
      {lat}
      {basemap}
      heading={t('feature_location')}
      emptyText={t('feature_no_location')}
      alt={t('feature_location_alt')}
      failed={t('feature_location_error')}
    />
  {/if}

  <Tabs.Root value="data">
    <Tabs.List>
      <Tabs.Trigger value="data">{t('feature_tab_data')}</Tabs.Trigger>
      <Tabs.Trigger value="activity">{t('feature_tab_activity')}</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="data" class="pt-4">
      <DataTab
        {groups}
        {project}
        generalLabel={t('feature_data_general')}
        emptyText={t('feature_data_empty')}
        noValue={t('feature_no_value')}
        onImage={(url, name) => (lightbox = { url, name })}
      />
    </Tabs.Content>
    <Tabs.Content value="activity" class="pt-4">
      <ActivityTab
        view={detail.activity}
        refusals={detail.refusals}
        lifecycles={detail.lifecycles}
        {project}
        {locale}
        {t}
        lifecycleName={(s) => lifecycleLabel(s, locale)}
        protokollHref={(run) =>
          `/admin/projects/${encodeURIComponent(project)}/types/${encodeURIComponent(typeKey)}/${encodeURIComponent(id)}/protokoll/${encodeURIComponent(run)}`}
        hasMore={next !== null}
        transitionRun={(at) => runs.find((r) => r.outcome === 'accepted' && r.receivedAt === at)?.id}
        {loadingMore}
        onMore={() => void more()}
        onImage={(url, name) => (lightbox = { url, name })}
      />
    </Tabs.Content>
  </Tabs.Root>
</div>

<ImageLightbox image={lightbox} fallbackTitle={t('feature_location_alt')} onClose={() => (lightbox = null)} />
