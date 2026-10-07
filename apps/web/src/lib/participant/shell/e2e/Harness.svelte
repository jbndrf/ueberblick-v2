<script lang="ts">
  // The shell's chrome without a device: the real header, bottom bar, detail shell (ModuleShell) and Zuletzt sheet,
  // wired with the shell's own panel functions the way MapScreen wires them, over a stand-in map (a div that reports
  // a tap on empty map). Test fixture only.
  import { ModuleShell } from '@ueberblick/ui';
  import type { FeatureId, Instant } from '@ueberblick/core/model';
  import RecentSheet from '../../sheets/recent/RecentSheet.svelte';
  import type { RecentRow } from '../../sheets/recent/recent';
  import { NO_BADGE, sumBadges, type ToolBadge } from '../badge';
  import type { BarItem } from '../bar';
  import BottomBar from '../BottomBar.svelte';
  import Header from '../Header.svelte';
  import { HEADER_VARS } from '../../layers';
  import { afterMapTap, detailOpen, fabStep, stepFab, toggle, type Panels } from '../panels';

  const params = new URLSearchParams(location.search);
  const badges: Record<string, ToolBadge> =
    params.get('badge') === 'big'
      ? { chat: { hard: 120, soft: false } }
      : params.get('badge') === 'soft'
        ? { chat: { hard: 0, soft: true } }
        : {};

  const rows: RecentRow[] = Array.from({ length: 40 }, (_, i) => ({
    id: `f${i}`,
    type: 'baum',
    typeLabel: 'Baum',
    label: `Linde ${i}`,
    hasLocation: true,
    look: { color: '#2b6cb0', size: 32 },
  })) as unknown as RecentRow[];

  let open: Panels = $state([]);
  let featureId: FeatureId | null = $state(null);
  const badge = $derived(sumBadges(badges, ['chat'], open.includes('tools')));

  function press(item: BarItem | 'recent'): void {
    if (item === 'location') return; // Standort acts on the map; this stand-in has no position
    open = item === 'create' ? stepFab(open) : toggle(open, item);
  }
</script>

<div class="app" style={HEADER_VARS}>
  <div class="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
    <Header
      locale="de"
      title="Bäume"
      syncing={params.get('syncing') === null ? undefined : 120}
      loading={params.get('loading') === null ? undefined : 'Objekte werden geladen ...'}
      toolsActive={true}
      {badge}
      onbutton={press}
    />
    <main class="relative flex-1 overflow-hidden">
      <!-- the stand-in map: a tap on it is a tap on empty map -->
      <button
        type="button"
        class="h-full w-full touch-none bg-muted"
        data-testid="map"
        onclick={() => (open = afterMapTap(open))}>Karte</button
      >
    </main>
  </div>
</div>
<BottomBar locale="de" toolsActive={true} fab={fabStep(open)} {badge} onbutton={press} />

<ModuleShell
  open={open.includes('feature')}
  title={featureId ?? ''}
  toggleLabel="Gruppe vergrößern oder verkleinern"
  closeLabel="Schließen"
  testid="detail-shell"
  onclose={() => (open = open.filter((s) => s !== 'feature'))}
>
  <p class="p-4">Detail von {featureId}</p>
</ModuleShell>

{#if open.includes('recent')}
  <RecentSheet
    open={true}
    {rows}
    now={'2026-10-01T12:00:00.000Z' as Instant}
    locale="de"
    besideDetail={detailOpen(open)}
    onopen={(id) => {
      featureId = id;
      open = toggle(open, 'feature');
    }}
    onclose={() => (open = open.filter((s) => s !== 'recent'))}
  />
{/if}
<p data-testid="state" class="sr-only">{open.join(',')}</p>
