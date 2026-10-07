<script lang="ts">
  // "Paket aus Datei importieren" (v3 `package-selector.svelte:254-316` handleFileImport, :550-590): the hint, the button
  // that opens the file picker, the progress and the result or the reason the file was refused. The pack then stands in
  // the list like a downloaded one and the map uses it at once.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Progress } from '@ueberblick/ui/components/ui/progress';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Upload from '@lucide/svelte/icons/upload';
  import { PACK_FILE_EXTENSION, streamChunks, type PackRefusal } from '@ueberblick/client';
  import { message, type Locale, type MessageKey } from '../../../messages';
  import type { Offline } from '../../../offline/model';

  interface Props {
    offline: Offline;
    locale: Locale;
    /** A download is running: v3 disables the import then. */
    disabled: boolean;
    /** The dialog may not close while a file is read (as it may not during a download). */
    importing: boolean;
  }
  let { offline, locale, disabled, importing = $bindable() }: Props = $props();

  /** One translated sentence per refusal kind (the registry's list; a new kind fails the type check here). */
  const REFUSAL: Record<PackRefusal, MessageKey> = {
    not_a_pack: 'offline_packages_refusal_not_a_pack',
    truncated: 'offline_packages_refusal_truncated',
    trailing_bytes: 'offline_packages_refusal_trailing_bytes',
    sha256_mismatch: 'offline_packages_refusal_sha256_mismatch',
    wrong_project: 'offline_packages_refusal_wrong_project',
    unsupported_version: 'offline_packages_refusal_unsupported_version',
    bad_manifest: 'offline_packages_refusal_bad_manifest',
    unsafe_name: 'offline_packages_refusal_unsafe_name',
    not_supported: 'offline_packages_refusal_not_supported',
    write_failed: 'offline_packages_refusal_write_failed',
  };

  type Note =
    | { kind: 'reading'; percent: number }
    | { kind: 'done'; tiles: number }
    | { kind: 'failed'; why: PackRefusal };
  let note: Note | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let clear: ReturnType<typeof setTimeout> | undefined;

  async function onFile(event: Event): Promise<void> {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (file === undefined) return;
    clearTimeout(clear);
    importing = true;
    note = { kind: 'reading', percent: 0 };
    try {
      const r = await offline.manager.importPack(streamChunks(file.stream()), (done, total) => {
        note = { kind: 'reading', percent: total > 0 ? Math.round((done / total) * 100) : 0 };
      });
      note = r.ok ? { kind: 'done', tiles: r.tiles } : { kind: 'failed', why: r.kind };
    } catch (e) {
      note = { kind: 'failed', why: 'write_failed' };
    } finally {
      importing = false;
      target.value = '';
    }
    // v3 clears the success line after 2 s; a refusal stays until the next try.
    if (note?.kind === 'done') clear = setTimeout(() => (note = undefined), 2000);
  }
</script>

<div class="mt-4 border-t pt-4" data-testid="import-section">
  <p class="mb-3 text-sm text-muted-foreground">{message(locale, 'offline_packages_import_hint')}</p>
  <input
    type="file"
    accept=".{PACK_FILE_EXTENSION}"
    class="hidden"
    tabindex="-1"
    aria-hidden="true"
    data-testid="import-input"
    bind:this={input}
    onchange={onFile}
  />
  <Button
    variant="outline"
    size="sm"
    class="w-full"
    onclick={() => input?.click()}
    disabled={importing || disabled || !offline.supported}
  >
    {#if importing}
      <Loader2 class="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
      {message(locale, 'offline_packages_importing')}
    {:else}
      <Upload class="mr-2 h-4 w-4" />
      {message(locale, 'offline_packages_import_button')}
    {/if}
  </Button>

  {#if note?.kind === 'reading'}
    <div class="mt-3" data-testid="import-progress">
      <Progress
        aria-label={message(locale, 'offline_packages_reading_file')}
        value={note.percent}
        class="h-2"
      />
      <p class="mt-1 text-xs text-muted-foreground">{message(locale, 'offline_packages_reading_file')}</p>
    </div>
  {:else if note?.kind === 'done'}
    <p class="mt-2 text-xs text-green-700 dark:text-green-400" data-testid="import-done" role="status">
      {message(locale, 'offline_packages_import_complete', { tileCount: note.tiles.toLocaleString(locale) })}
    </p>
  {:else if note?.kind === 'failed'}
    <p class="mt-2 text-xs text-destructive" data-testid="import-failed" role="alert">
      {message(locale, 'offline_packages_import_failed')}: {message(locale, REFUSAL[note.why])}
    </p>
  {/if}
</div>
