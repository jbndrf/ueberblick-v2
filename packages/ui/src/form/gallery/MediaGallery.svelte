<script lang="ts">
  // The files of one value as the kit carousel (v3 MediaGallery.svelte:176-230, Embla): `aspect-[2/3]` items, three
  // visible in a full column, one and a half in a half column, one in a narrow one. Images open the lightbox, other
  // files show as a file row with the name, and in `fill` mode every entry has a remove button. Adding stays in the
  // photo tool of the form field (it needs the camera and the pipeline); Daten uses `view`.
  import FileText from '@lucide/svelte/icons/file-text';
  import X from '@lucide/svelte/icons/x';
  import * as Carousel from '../../components/ui/carousel';
  import type { CarouselAPI } from '../../components/ui/carousel/context';
  import { m } from '../../paraglide/messages.js';
  import { photoUrlFromContext } from './context';
  import GalleryImage from './GalleryImage.svelte';
  import Lightbox from './Lightbox.svelte';
  import { carouselGestures } from './gestures';
  import { isImage, type GalleryFile } from './files';

  interface Props {
    files: readonly GalleryFile[];
    mode: 'fill' | 'view';
    /** The thumbnail size asked for: `list` (80 px) in Daten, `preview` (800 px) in the form strip. */
    size?: 'list' | 'preview';
    /** v3 `columnPosition`: how wide the field sits, which sets how many items show at once. */
    columnPosition?: 'full' | 'half' | 'third' | 'quarter';
    onRemove?: (index: number) => void;
  }
  let { files, mode, size = 'preview', columnPosition = 'full', onRemove }: Props = $props();

  const resolve = photoUrlFromContext();
  let lightboxOpen = $state(false);
  let lightboxIndex = $state(0);
  let api = $state<CarouselAPI | undefined>();

  // Without a resolver nothing can be drawn: every file is a file row.
  const showsImage = (f: GalleryFile): boolean => resolve !== undefined && isImage(f);
  const images = $derived(files.filter(showsImage));

  // v3 :67-93: 3 visible (basis-1/3), ~1.5 (basis-2/3), else 1; arrows only when more items than fit.
  const basis = $derived(
    columnPosition === 'full' ? 'basis-1/3' : columnPosition === 'half' ? 'basis-2/3' : 'basis-full',
  );
  const visible = $derived(columnPosition === 'full' ? 3 : 1);

  function open(file: GalleryFile): void {
    lightboxIndex = images.indexOf(file);
    lightboxOpen = lightboxIndex >= 0;
  }
</script>

{#if files.length > 0}
  <div class="space-y-2">
    <div class="touch-pan-y" data-testid="gallery" use:carouselGestures={api}>
      <Carousel.Root
        class="w-full"
        opts={{ align: 'start', containScroll: 'trimSnaps', dragFree: false }}
        setApi={(a) => (api = a)}
      >
        <Carousel.Content class="-ml-2">
          {#each files as file, index (index)}
            <Carousel.Item class="{basis} pl-2">
              <div class="group relative aspect-[2/3]">
                {#if resolve && showsImage(file)}
                  <button
                    type="button"
                    class="block h-full w-full cursor-pointer overflow-hidden rounded-md border border-border transition-colors hover:border-primary"
                    aria-label={m.ui_gallery_open({ name: file.name })}
                    onclick={() => open(file)}
                  >
                    <GalleryImage
                      sha256={file.sha256}
                      {size}
                      alt={file.name}
                      {resolve}
                      class="h-full w-full object-cover"
                    />
                  </button>
                {:else}
                  <div
                    class="flex h-full w-full flex-col items-center justify-center rounded-md border border-border bg-muted p-2"
                  >
                    <FileText class="mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    <span class="w-full truncate text-center text-xs text-muted-foreground">{file.name}</span>
                  </div>
                {/if}
                {#if mode === 'fill' && onRemove}
                  <button
                    type="button"
                    class="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-opacity"
                    aria-label={m.ui_gallery_remove({ name: file.name })}
                    onclick={() => onRemove(index)}
                  >
                    <X class="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                {/if}
              </div>
            </Carousel.Item>
          {/each}
        </Carousel.Content>
        {#if files.length > visible}
          <Carousel.Previous class="left-0 -translate-x-1/2" />
          <Carousel.Next class="right-0 translate-x-1/2" />
        {/if}
      </Carousel.Root>
    </div>
  </div>
  {#if resolve}
    <Lightbox {images} bind:index={lightboxIndex} bind:open={lightboxOpen} {resolve} />
  {/if}
{/if}
