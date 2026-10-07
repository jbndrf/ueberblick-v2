<script lang="ts">
  // v3's "Karteninhalt" sheet (FilterSheet.svelte:322-713): the Einfach tab, the Ansichten tab when the shell gives
  // views, further tabs a tool contributes (`extraTabs`, e.g. v3's Cluster), the "view active" banner and the
  // "Tabs verwalten" button. No overlay, so the map stays visible and usable. Left, w-80, at every width, as v3.
  import type { Snippet } from 'svelte';
  import * as Sheet from '@ueberblick/ui/components/ui/sheet';
  import * as Tabs from '@ueberblick/ui/components/ui/tabs';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { onMount, untrack } from 'svelte';
  import Sliders from '@lucide/svelte/icons/sliders-horizontal';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { message, type Locale } from '../../messages';
  import FilterSimple from './FilterSimple.svelte';
  import FilterViewsTab from './FilterViews.svelte';
  import type { ActiveView, FilterController } from './filter-controller';
  import type { FilterCard, FilterData } from './filter-model';
  import type { FilterViews } from './filter-views';

  /** A tab a tool contributes (`filter-tab`, WP-613); the shell passes only the tools that are on. */
  export interface ExtraTab {
    readonly key: string;
    readonly label: string;
    readonly body: Snippet;
  }

  interface Props {
    open?: boolean;
    data: FilterData;
    controller: FilterController;
    locale: Locale;
    /** Presets and saved filters; without it there is no Ansichten tab. */
    views?: FilterViews | undefined;
    extraTabs?: readonly ExtraTab[];
    /** Opens the place where the person switches tools on (Einstellungen, Erweiterte Funktionen). */
    onManageTabs?: () => void;
    /** The filter builder under the active saved view; a seam until the builder tool exists. */
    builder?: Snippet<[ActiveView]> | undefined;
    /** The remembered tab (v3 persisted it) and the call that remembers a change. */
    initialTab?: string | undefined;
    ontab?: (tab: string) => void;
  }
  let {
    open = $bindable(false),
    data,
    controller,
    locale,
    views,
    extraTabs = [],
    onManageTabs,
    builder,
    initialTab,
    ontab,
  }: Props = $props();

  // Counting walks the view's features (R14), so it happens only while the sheet is open: a change while it is
  // closed just marks the cards stale, and opening recounts once.
  let cards = $state<readonly FilterCard[]>([]);
  let stale = true;
  let filter = $state(untrack(() => controller.state()));
  let active = $state<ActiveView | null>(untrack(() => controller.activeView()));
  let tab = $state(untrack(() => initialTab ?? 'simple'));

  onMount(() => {
    const stopData = data.subscribe(() => {
      if (untrack(() => open)) cards = data.cards();
      else stale = true;
    });
    const stopFilter = controller.subscribe(() => {
      filter = controller.state();
      active = controller.activeView();
    });
    return () => {
      stopData();
      stopFilter();
    };
  });

  $effect(() => {
    if (open && stale) {
      stale = false;
      cards = untrack(() => data.cards());
    }
  });

  const hasTabs = $derived(views !== undefined || extraTabs.length > 0);
  // A tab that went away (a tool switched off) falls back to Einfach.
  $effect(() => {
    if (tab === 'views' ? views === undefined : tab !== 'simple' && !extraTabs.some((t) => t.key === tab))
      tab = 'simple';
  });

  const activeName = $derived.by((): string | undefined => {
    if (active === null || views === undefined) return undefined;
    return active.kind === 'preset'
      ? views.presets.find((p) => p.key === active?.key)?.label
      : views.saved?.find((s) => s.id === active?.key)?.name;
  });
</script>

{#snippet simpleBody()}
  {#if activeName !== undefined}
    <!-- While a view is active it masters the map; the switches are ignored. Surface that (v3 :367-390). -->
    <div
      class="mx-4 mt-6 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs"
      data-banner="view-active"
    >
      <div class="mb-2 font-medium">
        {message(locale, 'filter_view_override_title', { name: activeName })}
      </div>
      <div class="mb-2 text-muted-foreground">{message(locale, 'filter_view_override_description')}</div>
      <Button variant="outline" size="sm" class="h-7 w-full" onclick={() => controller.setActiveView(null)}>
        {message(locale, 'filter_deactivate_view')}
      </Button>
    </div>
  {/if}
  <FilterSimple {cards} {filter} {controller} {locale} locked={activeName !== undefined} />
{/snippet}

<Sheet.Root bind:open>
  <!-- Not modal: preventScroll off keeps `pointer-events` on the page, so the map takes taps while the sheet is open (v3). -->
  <Sheet.ContentNoOverlay side="left" class="w-80" preventScroll={false}>
    <Sheet.Header class="relative pr-20">
      <Sheet.Title>{message(locale, 'filter_title')}</Sheet.Title>
      <Sheet.Description>{message(locale, 'filter_description')}</Sheet.Description>
      {#if onManageTabs !== undefined}
        <Button
          variant="ghost"
          size="icon"
          class="absolute top-1 right-12 h-7 w-7"
          title={message(locale, 'filter_manage_tabs')}
          aria-label={message(locale, 'filter_manage_tabs')}
          onclick={onManageTabs}
        >
          <Sparkles class="h-4 w-4" />
        </Button>
      {/if}
    </Sheet.Header>

    {#if hasTabs}
      <Tabs.Root
        bind:value={tab}
        onValueChange={(v) => ontab?.(v)}
        class="mt-2 flex flex-1 flex-col overflow-hidden"
      >
        <Tabs.List class="w-full shrink-0">
          <Tabs.Trigger value="simple">
            <Sliders class="h-4 w-4" />
            <span>{message(locale, 'filter_tab_simple')}</span>
          </Tabs.Trigger>
          {#if views !== undefined}
            <Tabs.Trigger value="views">
              <Sparkles class="h-4 w-4" />
              <span>{message(locale, 'filter_tab_views')}</span>
            </Tabs.Trigger>
          {/if}
          {#each extraTabs as extra (extra.key)}
            <Tabs.Trigger value={extra.key}>
              <Sparkles class="h-4 w-4" />
              <span>{extra.label}</span>
            </Tabs.Trigger>
          {/each}
        </Tabs.List>
        <Tabs.Content value="simple" class="overflow-y-auto">{@render simpleBody()}</Tabs.Content>
        {#if views !== undefined}
          <Tabs.Content value="views" class="overflow-y-auto">
            <FilterViewsTab
              {views}
              {active}
              {locale}
              {builder}
              onselect={(v) => controller.setActiveView(v)}
            />
          </Tabs.Content>
        {/if}
        {#each extraTabs as extra (extra.key)}
          <Tabs.Content value={extra.key} class="overflow-y-auto">{@render extra.body()}</Tabs.Content>
        {/each}
      </Tabs.Root>
    {:else}
      {@render simpleBody()}
    {/if}
  </Sheet.ContentNoOverlay>
</Sheet.Root>
