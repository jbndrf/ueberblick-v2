<script lang="ts">
  // "Offline-Pakete" (v3 `package-selector.svelte`): the packs the server offers, each with a download button and its
  // progress, a copy of each downloaded pack saved to Downloads (v3 :383) and "Paket aus Datei importieren" (WP-668).
  // Not ported: the reference-data download after a pack (the device syncs its config itself). The area is drawn by the
  // admin when the pack is built, not here.
  import { onMount, untrack } from 'svelte';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Progress } from '@ueberblick/ui/components/ui/progress';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import CheckCircle from '@lucide/svelte/icons/check-circle';
  import Download from '@lucide/svelte/icons/download';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Package from '@lucide/svelte/icons/package';
  import type { PackManifestEntry } from '@ueberblick/client';
  import { message, type Locale } from '../../../messages';
  import { formatBytes } from '../../../offline/format';
  import type { Offline } from '../../../offline/model';
  import { watchPacks, type PackView } from '../../../offline/watch';
  import ImportSection from './ImportSection.svelte';
  import { saveToDownloads } from './saveFile';

  interface Props {
    open: boolean;
    offline: Offline;
    locale: Locale;
  }
  let { open = $bindable(), offline, locale }: Props = $props();

  type Listing =
    { status: 'loading' } | { status: 'error' } | { status: 'ok'; packs: readonly PackManifestEntry[] };
  let listing: Listing = $state({ status: 'loading' });
  let view: PackView = $state({ progress: untrack(() => offline.manager.progress.get()), counts: undefined });

  onMount(() => watchPacks(offline.manager, (v) => (view = v)));

  async function load(): Promise<void> {
    listing = { status: 'loading' };
    const r = await offline.list();
    listing = r.ok ? { status: 'ok', packs: r.packs } : { status: 'error' };
  }
  $effect(() => {
    if (open) void load();
  });

  const stateOf = (key: string) => view.progress[key]?.state;
  let saving: string | undefined = $state();
  let importing = $state(false);
  const downloadsRunning = $derived(
    Object.values(view.progress).some((p) => p.state === 'downloading' || p.state === 'queued'),
  );
  const busy = $derived(downloadsRunning || saving !== undefined || importing);

  // v3 keeps a copy of a downloaded pack in the user's Downloads, to import on another device. A refusal to save does
  // not undo the download.
  async function download(key: string): Promise<void> {
    await offline.manager.download([key]);
    if (offline.manager.progress.get()[key]?.state !== 'ready') return;
    saving = key;
    try {
      const file = await offline.manager.packFile(key);
      if (file !== undefined) saveToDownloads(file.blob, file.filename);
    } catch {
      // the pack is on the device either way
    } finally {
      saving = undefined;
    }
  }
  const tilesOf = (p: PackManifestEntry): number => p.layers.reduce((n, l) => n + l.tiles, 0);

  // v3 does not close the dialog while a download runs (`handleClose`).
  function onOpenChange(next: boolean): void {
    if (!next && busy) return;
    open = next;
  }
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="max-w-md" data-testid="package-dialog">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <Package class="h-5 w-5" />
        {message(locale, 'offline_packages_title')}
      </Dialog.Title>
      <Dialog.Description>{message(locale, 'offline_packages_description')}</Dialog.Description>
    </Dialog.Header>

    <div class="py-4">
      {#if listing.status === 'loading'}
        <div class="flex items-center justify-center py-8" data-testid="packages-loading">
          <Loader2 class="h-6 w-6 animate-spin motion-reduce:animate-none text-muted-foreground" />
        </div>
      {:else if listing.status === 'error'}
        <div class="flex flex-col items-center justify-center py-8 text-center" data-testid="packages-error">
          <AlertCircle class="mb-2 h-8 w-8 text-destructive" />
          <p class="text-sm text-destructive">{message(locale, 'offline_packages_load_error')}</p>
          <Button variant="outline" size="sm" class="mt-4" onclick={() => void load()}>
            {message(locale, 'offline_packages_try_again')}
          </Button>
        </div>
      {:else if listing.packs.length === 0}
        <div class="flex flex-col items-center justify-center py-8 text-center" data-testid="packages-none">
          <Package class="mb-2 h-8 w-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">{message(locale, 'offline_packages_none')}</p>
          <p class="mt-1 text-xs text-muted-foreground">{message(locale, 'offline_packages_none_hint')}</p>
        </div>
      {:else}
        <div class="space-y-3">
          {#each listing.packs as pack (pack.key)}
            {@const state = stateOf(pack.key)}
            {@const progress = view.progress[pack.key]}
            {@const downloading = state === 'downloading' || state === 'queued'}
            {@const done = state === 'ready'}
            <div
              class="rounded-lg border p-3 transition-colors"
              class:bg-green-50={done}
              class:dark:bg-green-950={done}
              data-testid="pack-row"
              data-pack={pack.key}
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="truncate font-medium">{pack.label}</div>
                  <div class="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    <div>
                      {message(locale, 'offline_packages_zoom', { min: pack.min_zoom, max: pack.max_zoom })}
                    </div>
                    <div>
                      {message(locale, 'offline_packages_tiles_size', {
                        tiles: tilesOf(pack).toLocaleString(locale),
                        size: formatBytes(pack.bytes, locale),
                      })}
                    </div>
                  </div>
                </div>

                <div class="shrink-0">
                  {#if done}
                    <Badge
                      variant="outline"
                      class="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                    >
                      <CheckCircle class="mr-1 h-3 w-3" />
                      {message(locale, 'offline_packages_downloaded')}
                    </Badge>
                  {:else if downloading}
                    <Badge variant="secondary">
                      <Loader2 class="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none" />
                      {message(locale, 'offline_packages_badge_downloading')}
                    </Badge>
                  {:else}
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => void download(pack.key)}
                      disabled={busy}
                    >
                      <Download class="mr-1 h-4 w-4" />
                      {message(locale, 'offline_packages_download')}
                    </Button>
                  {/if}
                </div>
              </div>

              {#if downloading && progress}
                <div class="mt-3">
                  <Progress
                    aria-label={pack.label}
                    value={progress.bytes_total > 0
                      ? Math.round((progress.bytes_done / progress.bytes_total) * 100)
                      : 0}
                    class="h-2"
                  />
                  <p class="mt-1 text-xs text-muted-foreground">
                    {message(locale, 'offline_packages_downloading_size', {
                      received: formatBytes(progress.bytes_done, locale),
                      total: formatBytes(progress.bytes_total, locale),
                    })}
                  </p>
                </div>
              {/if}

              {#if saving === pack.key}
                <div class="mt-3">
                  <Progress aria-label={pack.label} value={100} class="h-2" />
                  <p class="mt-1 text-xs text-muted-foreground">
                    {message(locale, 'offline_packages_saving_to_downloads')}
                  </p>
                </div>
              {/if}

              {#if state === 'failed'}
                <div class="mt-2 text-xs text-destructive" data-testid="pack-failed">
                  {message(locale, 'offline_packages_download_failed')}{progress?.reason
                    ? `: ${progress.reason}`
                    : ''}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <ImportSection {offline} {locale} disabled={downloadsRunning || saving !== undefined} bind:importing />

    <Dialog.Footer>
      <Button variant="outline" onclick={() => onOpenChange(false)} disabled={busy}>
        {busy
          ? message(locale, 'offline_packages_downloading_package')
          : message(locale, 'offline_packages_close')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
