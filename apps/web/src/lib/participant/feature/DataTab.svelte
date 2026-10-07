<script lang="ts">
  // v3's Daten tab: the admin's sub-tabs (a scrollable list, the default one named "Daten"), each with its rows
  // (`data/DataRows.svelte`), as `getVisibleDataTabs` / `getFieldsForFormRenderer` (state.svelte.ts 459-690; the module's
  // data `Tabs.Root`). The layout comes from the type's `display` settings (`data/layout.ts`); a plain model has the
  // default tab only. The relations of the feature are not here: v3 shows them in the header path (`relations/`, WP-647).
  import type { FeatureId } from '@ueberblick/core/model';
  import type { FeatureSheetModel } from '@ueberblick/ui';
  import * as Tabs from '@ueberblick/ui/components/ui/tabs';
  import { message, type Locale } from '../messages';
  import DataRows from './data/DataRows.svelte';
  import { DEFAULT_TAB, plainLines, type DataLayout } from './data/layout';

  interface Props {
    model: FeatureSheetModel & { layout?: DataLayout };
    locale: Locale;
    onopen: (id: FeatureId) => void;
  }
  let { model, locale, onopen }: Props = $props();

  const layout = $derived<DataLayout>(
    model.layout ?? {
      tabs:
        model.rows.length > 0 ? [{ name: DEFAULT_TAB, rows: model.rows, lines: plainLines(model.rows) }] : [],
      hints: {},
    },
  );
  let chosen = $state<string | undefined>(undefined);
  // v3 `activeName`: the chosen tab while it is still offered, else the first one.
  const active = $derived(
    layout.tabs.some((t) => t.name === chosen) ? (chosen as string) : (layout.tabs[0]?.name ?? DEFAULT_TAB),
  );
  const tabName = (name: string): string =>
    name === DEFAULT_TAB ? message(locale, 'feature_tab_data') : name;
</script>

{#if layout.tabs.length === 0}
  <p class="py-8 text-center text-sm text-muted-foreground">{message(locale, 'feature_no_data')}</p>
{:else if layout.tabs.length > 1}
  <Tabs.Root value={active} onValueChange={(v) => (chosen = v)}>
    <Tabs.List class="w-full flex-nowrap overflow-x-auto" data-testid="daten-subtabs">
      {#each layout.tabs as tab (tab.name)}
        <Tabs.Trigger value={tab.name} class="text-xs whitespace-nowrap">{tabName(tab.name)}</Tabs.Trigger>
      {/each}
    </Tabs.List>
    {#each layout.tabs as tab (tab.name)}
      <Tabs.Content value={tab.name} class="pt-4">
        <!-- Built only while active, like the sheet's tabs: hidden panels would cost render time (R14). -->
        {#if tab.name === active}
          <DataRows lines={tab.lines} history={model.history} hints={layout.hints} {locale} {onopen} />
        {/if}
      </Tabs.Content>
    {/each}
  </Tabs.Root>
{:else if layout.tabs[0] !== undefined}
  <DataRows lines={layout.tabs[0].lines} history={model.history} hints={layout.hints} {locale} {onopen} />
{/if}
