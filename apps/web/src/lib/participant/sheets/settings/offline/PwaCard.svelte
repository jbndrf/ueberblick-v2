<script lang="ts">
  // "App installieren" (v3 `SettingsSheet.svelte:559-651`): installed or in the browser, the install button, why the
  // install matters, and the technical details (service worker, install prompt). The state lives in `offline/pwa.ts`.
  import { onMount, untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import Download from '@lucide/svelte/icons/download';
  import Globe from '@lucide/svelte/icons/globe';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import { message, type Locale } from '../../../messages';
  import type { Pwa } from '../../../offline/pwa';

  interface Props {
    pwa: Pwa;
    locale: Locale;
  }
  let { pwa, locale }: Props = $props();

  let state = $state(untrack(() => pwa.get()));
  onMount(() => pwa.subscribe((s) => (state = s)));

  const swText = {
    checking: 'offline_sw_checking',
    registered: 'offline_sw_registered',
    error: 'offline_sw_error',
    unsupported: 'offline_sw_unsupported',
  } as const;
  const swColour = $derived(
    state.swStatus === 'registered'
      ? 'text-green-700'
      : state.swStatus === 'error'
        ? 'text-red-700'
        : 'text-yellow-700',
  );
</script>

<div class="space-y-2 rounded-md border p-3" data-testid="pwa-card">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      {#if state.mode === 'pwa'}
        <Smartphone class="h-4 w-4 text-green-700" />
        <span class="text-sm font-medium">{message(locale, 'offline_app_installed')}</span>
      {:else}
        <Globe class="h-4 w-4 text-muted-foreground" />
        <span class="text-sm font-medium">{message(locale, 'offline_running_in_browser')}</span>
      {/if}
    </div>
    {#if state.mode !== 'pwa' && !state.ios}
      <Button variant="outline" size="sm" onclick={() => void pwa.install()} disabled={!state.canInstall}>
        <Download class="mr-1 h-3 w-3" />
        {message(locale, 'offline_install')}
      </Button>
    {/if}
  </div>

  {#if state.mode === 'pwa'}
    <p class="text-xs text-green-700 dark:text-green-400">{message(locale, 'offline_pwa_standalone')}</p>
  {:else}
    <p class="text-xs text-muted-foreground">{message(locale, 'offline_pwa_hint')}</p>
    {#if state.ios}
      <p class="text-xs" data-testid="pwa-ios-steps">{message(locale, 'offline_pwa_ios_steps')}</p>
    {/if}
  {/if}

  <details class="mt-1">
    <summary class="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
      {message(locale, 'offline_technical_details')}
    </summary>
    <div class="mt-1 space-y-1 text-xs">
      <div class="flex justify-between">
        <span class="text-muted-foreground">{message(locale, 'offline_service_worker')}</span>
        <span class={swColour}>{message(locale, swText[state.swStatus])}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-muted-foreground">{message(locale, 'offline_install_prompt')}</span>
        <span class={state.canInstall ? 'text-green-700' : 'text-yellow-700'}>
          {state.canInstall ? message(locale, 'offline_available') : message(locale, 'offline_not_available')}
        </span>
      </div>
      {#if state.swError}
        <div class="text-red-700">
          {message(locale, 'offline_sw_error_detail', { message: state.swError })}
        </div>
      {/if}
    </div>
  </details>
</div>
