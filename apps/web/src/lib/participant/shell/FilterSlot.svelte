<script lang="ts">
  // The `filter` slot: Karteninhalt (v3 `FilterSheet`): the Einfach tab with one card per Objektart, and the Ansichten
  // tab with the role's project presets and the person's saved filters (WP-640, WP-612). The switches and the active
  // view are the filter controller's; the map draws a source with them laid over it (`MapCanvas`). The counts come
  // from the device and are computed only while the sheet is open (WP-625, R14). The saved filters and the
  // remembered tab live in the person's preference record, so they follow the person (`filters.saved`, `ui.filter_tab`).
  // The role's presets show for everyone in the role (Q20, WP-808); the person's own saved views are the tool "Ansichten"
  // (WP-665, v3 `filter.field_filters`): without it there are no saved views, and without presets no tab. Under the active saved view sits the builder (v3 FilterBuilder), which edits that view.
  import { onDestroy, onMount, untrack, type ComponentProps } from 'svelte';
  import type { FilterSource } from '@ueberblick/core/filters';
  import type { JsonValue } from '@ueberblick/core/model';
  import type { SavedFilter } from '@ueberblick/core/prefs';
  import FilterSheet from '../sheets/filter/FilterSheet.svelte';
  import ClusterTab from '../sheets/filter/cluster/ClusterTab.svelte';
  import { message } from '../messages';
  import { CLUSTER_TOOL } from '../tools/cluster';
  import { deviceFilterData } from '../sheets/filter/filter-model';
  import type { ActiveView } from '../sheets/filter/filter-controller';
  import ViewBuilder from '../sheets/filter/builder/ViewBuilder.svelte';
  import { devicePort } from '../sheets/filter/builder/port';
  import { presetsOf, viewsOffered, type FilterViews } from '../sheets/filter/filter-views';
  import { VIEWS_TOOL } from '../tools/entries';
  import type { SheetProps } from './sheets';

  let { ctx, onclose }: SheetProps = $props();

  let open = $state(true);
  onDestroy(() => ctx.filter.flush()); // the last switches reach the record when the sheet closes (WP-812)
  $effect(() => {
    if (!open) untrack(onclose);
  });

  // The view is fixed while the sheet is open; none means no map, so no cards.
  const data = untrack(() =>
    ctx.viewKey === null
      ? { cards: () => [], subscribe: () => () => undefined }
      : deviceFilterData(ctx.device, ctx.viewKey, ctx.locale, ctx.device.changed),
  );

  const record = untrack(() => ctx.record);
  let saved = $state<readonly SavedFilter[]>(record.current().filters.saved);
  onMount(() => record.subscribe(() => (saved = record.current().filters.saved)));

  const write = (next: readonly SavedFilter[]): void => {
    record.set('filters.saved', next as unknown as JsonValue);
    void record.sync();
  };
  const presets = presetsOf(
    untrack(() => ctx.device.config.file),
    untrack(() => ctx.device.roleKey ?? ''),
    untrack(() => ctx.locale),
  );

  const viewsOn = $derived(ctx.tools.entries.some((t) => t.key === VIEWS_TOOL && t.on));
  // The builder's view of the device: the offered fields, the creators by name. Made once, on the first view that opens.
  let port: ReturnType<typeof devicePort> | undefined;
  const portOf = () =>
    (port ??= devicePort(ctx.device, ctx.locale, message(ctx.locale, 'activity_unknown_actor')));
  const saveFilters = (id: string, filters: FilterSource): void =>
    write(saved.map((s) => (s.id === id ? { ...s, filters } : s)));

  // A new view starts empty (it lets everything through) and becomes the active one, so the builder opens under it
  // (v3 `handleSaveCurrentView`: "create and apply").
  const views: FilterViews = $derived({
    presets,
    saved: saved.map((s) => ({ id: s.id, name: s.name })),
    save(name) {
      const id = crypto.randomUUID();
      write([...saved, { id, name, filters: {} }]);
      ctx.filter.setActiveView({ kind: 'saved', key: id });
    },
    rename: (id, name) => write(saved.map((s) => (s.id === id ? { ...s, name } : s))),
    remove(id) {
      if (ctx.filter.activeView()?.key === id) ctx.filter.setActiveView(null);
      write(saved.filter((s) => s.id !== id));
    },
  });

  // Tools that contribute a tab (`filter-tab`) and are on for the person: v3's Cluster tab (WP-666).
  const clusterOn = $derived(ctx.tools.entries.some((t) => t.key === CLUSTER_TOOL && t.on));
  const extraTabs: ComponentProps<typeof FilterSheet>['extraTabs'] = $derived(
    clusterOn
      ? [{ key: CLUSTER_TOOL, label: message(ctx.locale, 'tool_cluster_tab'), body: clusterBody }]
      : [],
  );
</script>

{#snippet clusterBody()}
  <ClusterTab locale={ctx.locale} person={ctx.tools.person} map={ctx.map} />
{/snippet}

{#snippet builder(active: ActiveView)}
  {@const view = saved.find((s) => s.id === active.key)}
  {#if view !== undefined}
    {#key view.id}
      <ViewBuilder
        port={portOf()}
        filters={view.filters}
        locale={ctx.locale}
        onsave={(filters) => saveFilters(view.id, filters)}
      />
    {/key}
  {/if}
{/snippet}

<FilterSheet
  bind:open
  {data}
  controller={ctx.filter}
  locale={ctx.locale}
  views={viewsOffered(presets, viewsOn ? views : undefined)}
  {builder}
  {extraTabs}
  onManageTabs={ctx.manageTabs}
  initialTab={untrack(() => record.current().ui.filter_tab)}
  ontab={(tab) => {
    record.set('ui.filter_tab', tab);
    void record.sync();
  }}
/>
