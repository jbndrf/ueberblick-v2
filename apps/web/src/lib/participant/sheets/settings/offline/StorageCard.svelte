<script lang="ts">
  // "Speicher" (v3 `SettingsSheet.svelte:817-870`): the usage bar, the counts and the persistent-storage line. Read
  // when the tab opens and when the set of packs or the kept thumbnails change. Dateien are the thumbnails of Offline-Bilder
  // on the device (WP-667); Einträge are the features on the device.
  import { onMount } from 'svelte';
  import { message, type Locale } from '../../../messages';
  import type { OfflineContext } from '../../../offline/context';
  import { formatBytes } from '../../../offline/format';
  import { storageStats, type StorageStats } from '../../../offline/stats';
  import { watchPacks } from '../../../offline/watch';

  interface Props {
    context: Pick<OfflineContext, 'offline' | 'storage' | 'images'>;
    locale: Locale;
    /** Features on the device (the sync status). */
    records: number;
  }
  let { context, locale, records }: Props = $props();

  let stats: StorageStats | undefined = $state();
  let latest = 0;

  async function read(counts: Parameters<typeof storageStats>[0]['counts']): Promise<void> {
    const mine = ++latest;
    const [estimate, persisted] = await Promise.all([
      context.storage.estimate(),
      context.storage.persisted(),
    ]);
    const files = await context.images.files();
    if (mine === latest) stats = storageStats({ estimate, persisted, counts, records, files });
  }

  let counts: Parameters<typeof storageStats>[0]['counts'] | undefined;
  onMount(() => {
    const stopPacks = watchPacks(context.offline.manager, (v) => {
      counts = v.counts;
      if (counts !== undefined) void read(counts);
    });
    // thumbnails come and go while the tab is open: the Dateien cell follows when a job ends
    let phase = context.images.state().phase;
    const stopImages = context.images.subscribe((s) => {
      if (s.phase !== phase && s.phase === 'idle' && counts !== undefined) void read(counts);
      phase = s.phase;
    });
    return () => {
      stopPacks();
      stopImages();
    };
  });
  // the record count follows the sync
  $effect(() => {
    if (stats !== undefined && stats.records !== records) stats = { ...stats, records };
  });

  const bar = { ok: 'bg-primary', warn: 'bg-orange-500', high: 'bg-red-500' } as const;
</script>

{#if stats}
  <div class="space-y-2" data-testid="storage-section">
    <h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {message(locale, 'offline_storage')}
    </h4>
    <div class="space-y-3 rounded-md border p-3">
      {#if stats.quota > 0}
        <div class="space-y-1" data-testid="storage-bar">
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">
              {message(locale, 'offline_storage_of', {
                used: formatBytes(stats.usage, locale),
                total: formatBytes(stats.quota, locale),
              })}
            </span>
            <span class="font-medium"
              >{stats.percent.toLocaleString(locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}%</span
            >
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full transition-all {bar[stats.level]}"
              data-level={stats.level}
              style="width: {stats.percent}%"
            ></div>
          </div>
        </div>
      {/if}

      <div class="grid gap-2 text-center {stats.files === undefined ? 'grid-cols-2' : 'grid-cols-3'}">
        <div class="rounded bg-muted/50 px-2 py-1.5" data-testid="count-tiles">
          <div class="text-sm font-medium">{stats.tiles.toLocaleString(locale)}</div>
          <div class="text-[10px] text-muted-foreground">{message(locale, 'offline_storage_tiles')}</div>
        </div>
        {#if stats.files !== undefined}
          <div class="rounded bg-muted/50 px-2 py-1.5" data-testid="count-files">
            <div class="text-sm font-medium">{stats.files.toLocaleString(locale)}</div>
            <div class="text-[10px] text-muted-foreground">{message(locale, 'offline_storage_files')}</div>
          </div>
        {/if}
        <div class="rounded bg-muted/50 px-2 py-1.5" data-testid="count-records">
          <div class="text-sm font-medium">{stats.records.toLocaleString(locale)}</div>
          <div class="text-[10px] text-muted-foreground">{message(locale, 'offline_storage_records')}</div>
        </div>
      </div>

      <div class="flex items-center justify-between text-xs">
        <span class="text-muted-foreground">{message(locale, 'offline_persistent')}</span>
        <span
          class={stats.persistent
            ? 'text-green-700 dark:text-green-400'
            : 'text-orange-700 dark:text-orange-400'}
          data-testid="persistent"
        >
          {stats.persistent
            ? message(locale, 'offline_persistent_on')
            : message(locale, 'offline_persistent_off')}
        </span>
      </div>
    </div>
  </div>
{/if}
