<script lang="ts">
  // v3 add dialog, tab "Hochladen" (`LayersSection.svelte:712-795`): Name, Kachelformat (PNG / JPG / WEBP), Kacheldatei with
  // its hint, a progress line with a bar ("Wird hochgeladen... x MB / y MB (n%)", then "Wird verarbeitet... n%") and the
  // button "Kacheln hochladen". v4: the server converts the file to one PMTiles archive (A-044) and, once it is done, the
  // layer is added to the draft here; MBTiles and PMTiles say their own format, so the format buttons rest for them; a
  // refusal names its typed reason in the page language.
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Upload from '@lucide/svelte/icons/upload';
  import type { TileUploadFormat } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Progress } from '@ueberblick/ui/components/ui/progress';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { LayerDraft } from './layers-model';
  import {
    kindOfFile,
    layerOfResult,
    nameOfFile,
    uploadFile,
    UploadFailure,
    watchJob,
    type UploadJobView,
  } from './tile-upload';

  let {
    locale,
    project,
    id,
    onadd,
    onvector,
    fetchFn = (...args) => fetch(...args),
    wait,
  }: {
    locale: Locale;
    project: string;
    /** Prefix of the field ids. */
    id: string;
    /** Adds the layer to the draft; true when it worked (the dialog closes). */
    onadd: (layer: LayerDraft) => Promise<boolean>;
    /** A vector archive: the name and URL for the PMTiles tab, which asks for the source layer. */
    onvector: (name: string, url: string) => void;
    fetchFn?: typeof fetch;
    wait?: (ms: number) => Promise<void>;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const FORMATS: readonly TileUploadFormat[] = ['png', 'jpg', 'webp'];

  /** The dialog closing or the tab going away stops the upload and the poll. */
  const closing = new AbortController();
  $effect(() => () => closing.abort());

  let name = $state('');
  let format = $state<TileUploadFormat>('png');
  let file = $state<File | null>(null);
  let busy = $state(false);
  let problem = $state<string | null>(null);
  let sending = $state<{ loaded: number; total: number } | null>(null);
  let processing = $state<number | null>(null);

  const kind = $derived(file === null ? null : kindOfFile(file.name));
  const fixed = $derived(kind === 'mbtiles' || kind === 'pmtiles');
  const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);
  const percent = $derived(
    sending !== null
      ? sending.total === 0
        ? 0
        : Math.round((sending.loaded / sending.total) * 100)
      : (processing ?? 0),
  );

  function pick(event: Event): void {
    file = (event.target as HTMLInputElement).files?.[0] ?? null;
    problem = null;
    if (file !== null && name === '') name = nameOfFile(file.name);
  }

  const reasonText = (e: unknown): string =>
    t(`settings_layers_upload_err_${e instanceof UploadFailure ? e.reason : 'unknown'}` as AdminKey);

  function fail(text: string, toastText = text): void {
    problem = text;
    toast.error(toastText);
  }

  async function finish(job: UploadJobView): Promise<void> {
    if (job.state === 'failed' || job.result === undefined) {
      const key = `settings_layers_upload_err_${job.error?.reason ?? 'unknown'}` as AdminKey;
      return fail(t(key), t('settings_layers_upload_processing_failed'));
    }
    toast.success(t('settings_layers_upload_processing_done'));
    const layer = layerOfResult(name, job.result);
    if (layer === null) {
      toast.info(t('settings_layers_upload_vector_hint'));
      return onvector(name.trim(), job.result.url);
    }
    await onadd(layer);
  }

  async function upload(): Promise<void> {
    if (file === null || name.trim() === '' || kind === null) return;
    busy = true;
    problem = null;
    try {
      const uploadId = await uploadFile({
        fetch: fetchFn,
        project,
        file,
        name: name.trim(),
        format: fixed ? undefined : format,
        signal: closing.signal,
        ...(wait === undefined ? {} : { wait }),
        onProgress: (loaded, total) => (sending = { loaded, total }),
      });
      sending = null;
      processing = 0;
      toast.success(t('settings_layers_upload_complete_processing'));
      const job = await watchJob({
        fetch: fetchFn,
        project,
        id: uploadId,
        signal: closing.signal,
        ...(wait === undefined ? {} : { wait }),
        onJob: (j) =>
          (processing = j.progress.total === 0 ? 0 : Math.round((j.progress.done / j.progress.total) * 100)),
      });
      await finish(job);
      if (job.state === 'done') {
        name = '';
        file = null;
      }
    } catch (e) {
      if (!closing.signal.aborted) fail(reasonText(e), t('settings_layers_upload_failed'));
    } finally {
      busy = false;
      sending = null;
      processing = null;
    }
  }
</script>

<div class="space-y-4" data-testid="layer-upload">
  <div class="space-y-2">
    <Label for="{id}-name">{t('settings_layers_field_name')}</Label>
    <Input
      id="{id}-name"
      bind:value={name}
      placeholder={t('settings_layers_upload_name_placeholder')}
      required
    />
  </div>
  <div class="space-y-2">
    <Label>{t('settings_layers_upload_tile_format')}</Label>
    <div class="flex gap-2">
      {#each FORMATS as fmt (fmt)}
        <Button
          type="button"
          variant={format === fmt && !fixed ? 'default' : 'outline'}
          size="sm"
          disabled={fixed}
          aria-pressed={format === fmt}
          onclick={() => (format = fmt)}
        >
          {fmt.toUpperCase()}
        </Button>
      {/each}
    </div>
    {#if fixed}<p class="text-xs text-muted-foreground">
        {t('settings_layers_upload_format_from_file')}
      </p>{/if}
  </div>
  <div class="space-y-2">
    <Label for="{id}-file">{t('settings_layers_upload_file')}</Label>
    <Input id="{id}-file" type="file" accept=".zip,.mbtiles,.pmtiles" onchange={pick} disabled={busy} />
    <p class="text-xs text-muted-foreground">{t('settings_layers_upload_file_hint')}</p>
  </div>
  {#if sending !== null || processing !== null}
    <div class="space-y-1" data-testid="upload-progress" aria-live="polite">
      <p class="text-sm">
        {#if sending !== null}
          {t('settings_layers_upload_uploading')}
          {t('settings_layers_upload_size', {
            loaded: mb(sending.loaded),
            total: mb(sending.total),
            percent,
          })}
        {:else}
          {t('settings_layers_upload_processing')} {percent}%
        {/if}
      </p>
      <Progress value={percent} aria-label={t('settings_layers_upload_uploading')} />
    </div>
  {/if}
  {#if problem}<p class="text-sm text-destructive" role="alert">{problem}</p>{/if}
  <Button type="button" onclick={() => void upload()} disabled={busy || file === null || name.trim() === ''}>
    {#if busy}
      <Loader2 class="mr-2 h-4 w-4 animate-spin" />
      {t('settings_layers_upload_uploading')}
    {:else}
      <Upload class="mr-2 h-4 w-4" />
      {t('settings_layers_upload_submit')}
    {/if}
  </Button>
</div>
