<script lang="ts">
  // One image of a file value. The URL comes from the app's resolver (queued bytes first, else a server thumbnail).
  import type { ThumbSizeKey } from '@ueberblick/core/registry';
  import type { PhotoUrl } from './files';

  interface Props {
    sha256: string;
    size: ThumbSizeKey;
    alt: string;
    resolve: PhotoUrl;
    class?: string;
  }
  let { sha256, size, alt, resolve, class: className = '' }: Props = $props();

  let src = $state<string | undefined>(undefined);
  let failed = $state(false);
  // A thumbnail that does not load falls back to the original; if that fails too, the placeholder shows. Never a
  // broken image with its alt text (the file name).
  function onError() {
    const full = resolve.original(sha256);
    if (src !== full) src = full;
    else failed = true;
  }
  $effect(() => {
    const id = sha256;
    const wanted = size;
    let cancelled = false;
    src = undefined;
    failed = false;
    void Promise.resolve(resolve(id, wanted)).then((url) => {
      if (!cancelled) src = url;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if src !== undefined && !failed}
  <img {src} {alt} class={className} loading="lazy" decoding="async" onerror={onError} />
{:else}
  <span class={`${className} bg-muted`} role="img" aria-label={alt}></span>
{/if}
