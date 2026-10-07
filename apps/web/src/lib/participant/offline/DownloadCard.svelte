<script lang="ts">
  // The download card above the bar (v3 `map/+page.svelte:2791`): outside every sheet, so a download that was
  // started in Einstellungen stays visible while the person works on the map. Shown only while a pack downloads.
  import { LAYER } from '../layers';
  import { onMount, untrack } from 'svelte';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import type { PackProgress } from '@ueberblick/client';
  import { message, type Locale } from '../messages';
  import { formatBytes } from './format';
  import type { Offline } from './model';
  import { downloadingNow } from './progress';

  interface Props {
    offline: Offline;
    locale: Locale;
  }
  let { offline, locale }: Props = $props();

  let progress: Readonly<Record<string, PackProgress>> = $state(
    untrack(() => offline.manager.progress.get()),
  );
  onMount(() => offline.manager.progress.subscribe((p) => (progress = p)));
  const now = $derived(downloadingNow(progress, (key) => key));
</script>

{#if now}
  <div
    class={['fixed right-4 bottom-20 left-4 md:right-4 md:left-auto md:w-80', LAYER.card]}
    data-testid="download-card"
  >
    <div class="rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-sm">
      <div class="mb-2 flex items-center gap-2">
        <Loader2 class="h-4 w-4 animate-spin motion-reduce:animate-none text-blue-600" />
        <span class="text-sm font-medium">{message(locale, 'offline_downloading_offline_data')}</span>
      </div>
      <p class="text-xs text-muted-foreground">
        {message(locale, 'offline_packages_downloading_size', {
          received: formatBytes(now.done, locale),
          total: formatBytes(now.total, locale),
        })}
      </p>
    </div>
  </div>
{/if}
