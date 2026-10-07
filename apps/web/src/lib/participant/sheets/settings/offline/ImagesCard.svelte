<script lang="ts">
  // "Offline-Bilder" (v3 `SettingsSheet.svelte:740-800`): the switch that keeps photo thumbnails on the device, its
  // progress while it downloads or removes, and its description. It stands under Kartenkacheln in the Offline-Daten
  // section, as in v3. The switch is the person's preference, so it follows the person to another device.
  import { onMount, untrack } from 'svelte';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { message, type Locale } from '../../../messages';
  import type { OfflineImages } from '../../../offline/images';

  interface Props {
    images: OfflineImages;
    locale: Locale;
  }
  let { images, locale }: Props = $props();

  let state = $state(untrack(() => images.state()));
  onMount(() => images.subscribe((s) => (state = s)));

  const busy = $derived(state.phase !== 'idle');
</script>

{#if images.supported}
  <div class="space-y-2 rounded-md border p-3" data-testid="images-card">
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium" id="offline-images-label">{message(locale, 'offline_images')}</span>
      <Switch
        checked={state.enabled}
        aria-labelledby="offline-images-label"
        disabled={busy}
        onCheckedChange={(on) => void images.setEnabled(on)}
      />
    </div>

    {#if busy}
      <div class="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400" data-testid="images-busy">
        <Loader2 class="h-4 w-4 animate-spin motion-reduce:animate-none" />
        <span>
          {state.phase === 'downloading'
            ? message(locale, 'offline_images_downloading')
            : message(locale, 'offline_images_removing')}
        </span>
      </div>
      {#if state.phase === 'downloading' && state.total > 0}
        <p class="text-xs text-muted-foreground" data-testid="images-progress">
          {message(locale, 'offline_images_progress', { done: state.done, total: state.total })}
        </p>
      {/if}
    {:else if state.enabled}
      <p class="text-xs text-green-700 dark:text-green-400" data-testid="images-on">
        {message(locale, 'offline_images_cached')}
      </p>
    {:else}
      <p class="text-xs text-muted-foreground" data-testid="images-desc">
        {message(locale, 'offline_images_desc')}
      </p>
    {/if}
  </div>
{/if}
