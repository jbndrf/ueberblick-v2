<script lang="ts">
  // "Kartenkacheln" (v3 `SettingsSheet.svelte:653-761`): what map data is on the device and how to get, change or delete
  // it. v3 held one pack; a project may offer several (A-032), so each ready pack has its own box and its own Löschen.
  import { onMount, untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Package from '@lucide/svelte/icons/package';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { message, type Locale } from '../../../messages';
  import { formatBytes, formatDay } from '../../../offline/format';
  import type { Offline } from '../../../offline/model';
  import { watchPacks, type PackView } from '../../../offline/watch';

  interface Props {
    offline: Offline;
    locale: Locale;
    /** Opens the pack selector ("Kacheln herunterladen", "Bereich ändern"). */
    onchoose: () => void;
  }
  let { offline, locale, onchoose }: Props = $props();

  let view: PackView = $state({ progress: untrack(() => offline.manager.progress.get()), counts: undefined });
  let confirming: string | undefined = $state();
  let deleting: string | undefined = $state();

  onMount(() => watchPacks(offline.manager, (v) => (view = v)));

  const running = $derived(
    Object.entries(view.progress).find(([, p]) => p.state === 'downloading' || p.state === 'queued'),
  );
  const packs = $derived(view.counts?.packs ?? []);
  const labelOf = (key: string): string => packs.find((p) => p.key === key)?.label ?? key;

  async function remove(key: string): Promise<void> {
    deleting = key;
    try {
      await offline.manager.remove([key]);
    } finally {
      deleting = undefined;
      confirming = undefined;
    }
  }
</script>

<div class="space-y-2 rounded-md border p-3" data-testid="tiles-card">
  <div class="text-sm font-medium">{message(locale, 'offline_tiles_title')}</div>
  <p class="text-xs text-muted-foreground">{message(locale, 'offline_tiles_desc')}</p>

  {#if !offline.supported}
    <p class="text-xs text-orange-700 dark:text-orange-400" data-testid="tiles-unsupported">
      {message(locale, 'offline_tiles_unsupported')}
    </p>
  {:else if running}
    {@const [key, p] = running}
    <div class="rounded-md bg-blue-50 p-2 dark:bg-blue-950" data-testid="tiles-downloading">
      <div class="flex items-center gap-2">
        <Loader2 class="h-4 w-4 animate-spin motion-reduce:animate-none text-blue-600" />
        <span class="text-xs font-medium text-blue-700 dark:text-blue-300">
          {message(locale, 'offline_downloading')}
        </span>
      </div>
      <p class="mt-1 text-xs text-blue-600 dark:text-blue-400">{labelOf(key)}</p>
      <p class="text-xs text-blue-600 dark:text-blue-400">
        {message(locale, 'offline_packages_downloading_size', {
          received: formatBytes(p.bytes_done, locale),
          total: formatBytes(p.bytes_total, locale),
        })}
      </p>
    </div>
  {:else if view.counts === undefined}
    <div class="flex items-center gap-2 text-sm text-muted-foreground" data-testid="tiles-loading">
      <Loader2 class="h-4 w-4 animate-spin motion-reduce:animate-none" />
      <span>{message(locale, 'offline_loading')}</span>
    </div>
  {:else if packs.length > 0}
    {#each packs as pack (pack.key)}
      <div class="rounded-md bg-green-50 p-2 dark:bg-green-950" data-testid="ready-pack" data-pack={pack.key}>
        <div class="flex items-center gap-2">
          <Package class="h-4 w-4 text-green-700" />
          <span class="text-xs font-medium text-green-700 dark:text-green-300">{pack.label}</span>
        </div>
        <div class="mt-1 space-y-0.5 text-xs text-green-700 dark:text-green-400">
          <p>{formatDay(pack.built_at, locale)}</p>
          <p>
            {message(locale, 'offline_tile_count', { count: pack.tiles.toLocaleString(locale) })}
            ({formatBytes(pack.bytes, locale)})
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        {#if packs.length === 1}
          <Button variant="outline" size="sm" class="flex-1" onclick={onchoose}>
            <Package class="mr-1 h-3 w-3" />
            {message(locale, 'offline_change_area')}
          </Button>
        {/if}
        {#if confirming === pack.key}
          <Button
            variant="destructive"
            size="sm"
            class="flex-1"
            onclick={() => void remove(pack.key)}
            disabled={deleting === pack.key}
          >
            {#if deleting === pack.key}<Loader2
                class="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none"
              />{/if}
            {message(locale, 'offline_confirm_delete')}
          </Button>
        {:else}
          <Button variant="outline" size="sm" class="flex-1" onclick={() => (confirming = pack.key)}>
            <Trash2 class="mr-1 h-3 w-3" />
            {message(locale, 'offline_delete')}
          </Button>
        {/if}
      </div>
    {/each}
    {#if packs.length > 1}
      <Button variant="outline" size="sm" class="w-full" onclick={onchoose}>
        <Package class="mr-1 h-3 w-3" />
        {message(locale, 'offline_change_area')}
      </Button>
    {/if}
  {:else}
    <p class="text-xs text-orange-700 dark:text-orange-400">{message(locale, 'offline_no_tiles')}</p>
    <Button variant="default" size="sm" class="w-full" onclick={onchoose}>
      <Package class="mr-2 h-4 w-4" />
      {message(locale, 'offline_download_tiles')}
    </Button>
  {/if}
</div>
