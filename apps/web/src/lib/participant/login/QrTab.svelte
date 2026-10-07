<script lang="ts">
  // v3 login QR tab (+page.svelte:82-166, 296-363): in-app camera scanner and "upload a QR image". The scanner
  // library loads when this tab mounts; leaving the tab (unmount) stops the camera.
  import { onDestroy, onMount } from 'svelte';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import Camera from '@lucide/svelte/icons/camera';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Upload from '@lucide/svelte/icons/upload';
  import { Button, buttonVariants } from '@ueberblick/ui/components/ui/button';
  import { cn } from '@ueberblick/ui/utils';
  import { message, type Locale } from '../messages';
  import { tokenFromScan } from './scan';
  import type { LoadScanner, QrScanner } from './scanner';

  let {
    locale,
    load,
    onToken,
    onSwitch,
  }: {
    locale: Locale;
    load: LoadScanner;
    onToken: (token: string) => void;
    onSwitch: () => void;
  } = $props();

  const READER = 'qr-reader';
  let scanner: QrScanner | undefined = $state();
  let running = $state(false);
  let error: string | undefined = $state();
  let gone = false;
  let uploads = 0;
  /** A decode that has not answered by then is a failure, never a spinner-less silence (WP-867). */
  const DECODE_MS = 15_000;

  onMount(() => {
    load(READER).then(
      (s) => {
        if (gone) void s.stop();
        else scanner = s;
      },
      (err: unknown) => {
        console.error('QR scanner failed to load:', err);
        error = message(locale, 'login_qr_init_error');
      },
    );
  });

  async function stop(): Promise<void> {
    running = false;
    await scanner?.stop();
  }

  onDestroy(() => {
    gone = true;
    void stop();
  });

  async function decoded(text: string): Promise<void> {
    const result = tokenFromScan(text, location.origin);
    if (result === undefined || result.kind === 'invalid') {
      error = message(locale, result === undefined ? 'login_qr_no_token' : 'login_qr_invalid');
      return;
    }
    await stop();
    onToken(result.token);
  }

  async function start(): Promise<void> {
    if (scanner === undefined || running) return;
    error = undefined;
    running = true;
    try {
      await scanner.startCamera((text) => void decoded(text));
    } catch (err) {
      running = false;
      console.error('Camera error:', err);
      error = message(locale, 'login_qr_camera_error');
    }
  }

  async function upload(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined || scanner === undefined) return;
    error = undefined;
    const mine = ++uploads;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const text = await Promise.race([
        scanner.scanFile(file),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('QR decode timed out')), DECODE_MS);
        }),
      ]);
      if (mine === uploads) await decoded(text);
    } catch {
      if (mine === uploads) error = message(locale, 'login_qr_file_error');
    } finally {
      clearTimeout(timer);
    }
    input.value = '';
  }
</script>

<div class="space-y-4">
  <div
    id={READER}
    class="min-h-[250px] overflow-hidden rounded-lg border-2 border-muted-foreground/25 bg-muted/10"
  ></div>

  {#if error !== undefined}
    <div
      role="alert"
      class="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle class="h-4 w-4 shrink-0" />
      <span>{error}</span>
    </div>
  {/if}

  <div class="flex gap-2">
    {#if !running}
      <Button type="button" variant="outline" class="flex-1" onclick={start} disabled={scanner === undefined}>
        <Camera class="mr-2 h-4 w-4" />
        {scanner === undefined
          ? message(locale, 'login_qr_loading')
          : message(locale, 'login_qr_start_camera')}
      </Button>
    {:else}
      <Button type="button" variant="outline" class="flex-1" onclick={stop}>
        <Loader2 class="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
        {message(locale, 'login_qr_stop_camera')}
      </Button>
    {/if}

    <label
      class={cn(
        buttonVariants({ variant: 'outline' }),
        'flex-1 cursor-pointer focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        scanner === undefined && 'pointer-events-none opacity-50',
      )}
    >
      <Upload class="mr-2 h-4 w-4" />
      {message(locale, 'login_qr_upload')}
      <input
        type="file"
        accept="image/*"
        class="sr-only"
        disabled={scanner === undefined}
        onchange={upload}
      />
    </label>
  </div>

  <p class="text-center text-xs text-muted-foreground">{message(locale, 'login_qr_hint')}</p>

  <p class="text-center text-sm text-muted-foreground">
    {message(locale, 'login_or')}
    <button type="button" class="text-primary hover:underline" onclick={onSwitch}>
      {message(locale, 'login_switch_to_token')}
    </button>
  </p>
</div>

<style>
  :global(#qr-reader video) {
    border-radius: 0.5rem;
  }
  :global(#qr-reader__scan_region) {
    min-height: 200px;
  }
  :global(#qr-reader__dashboard) {
    display: none !important;
  }
</style>
