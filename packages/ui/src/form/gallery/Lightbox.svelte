<script lang="ts">
  // The full-size view of the images of one value (v3 MediaGallery.svelte:262-318): previous and next, a counter,
  // Esc and the arrow keys. v3 had no zoom; none ported (review 1).
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '../../components/ui/button';
  import * as Dialog from '../../components/ui/dialog';
  import { m } from '../../paraglide/messages.js';
  import GalleryImage from './GalleryImage.svelte';
  import type { GalleryFile, PhotoUrl } from './files';

  interface Props {
    images: readonly GalleryFile[];
    index: number;
    open: boolean;
    resolve: PhotoUrl;
  }
  let { images, index = $bindable(0), open = $bindable(false), resolve }: Props = $props();

  const current = $derived(images[index]);

  const go = (to: number): void => {
    if (to < 0 || to >= images.length) return;
    index = to;
  };
  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window onkeydown={open ? onkeydown : undefined} />

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-4xl border-none bg-black/95 p-0" showCloseButton={false}>
    <Dialog.Title class="sr-only">{current?.name ?? ''}</Dialog.Title>
    <Dialog.Description class="sr-only">{m.ui_gallery_lightbox()}</Dialog.Description>
    {#if current}
      <div class="relative flex min-h-[50vh] items-center justify-center overflow-auto">
        <GalleryImage
          sha256={current.sha256}
          size="preview"
          alt={current.name}
          {resolve}
          class="max-h-[80vh] max-w-full object-contain"
        />
        {#if images.length > 1}
          <Button
            variant="ghost"
            size="icon"
            class="absolute top-1/2 left-2 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
            disabled={index === 0}
            aria-label={m.ui_gallery_previous()}
            onclick={() => go(index - 1)}
          >
            <ChevronLeft class="h-6 w-6" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="absolute top-1/2 right-2 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
            disabled={index === images.length - 1}
            aria-label={m.ui_gallery_next()}
            onclick={() => go(index + 1)}
          >
            <ChevronRight class="h-6 w-6" />
          </Button>
          <div
            class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white"
          >
            {m.ui_gallery_counter({ current: index + 1, total: images.length })}
          </div>
        {/if}
        <Button
          variant="ghost"
          size="icon"
          class="absolute top-2 right-2 bg-black/50 text-white hover:bg-black/70"
          aria-label={m.ui_gallery_close()}
          onclick={() => (open = false)}
        >
          <X class="h-5 w-5" />
        </Button>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
