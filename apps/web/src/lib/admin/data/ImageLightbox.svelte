<script lang="ts">
  // The picture of a file cell at full size (v3: the dialog the data page opens for a thumbnail), shared by the table
  // and the detail page.
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';

  let {
    image,
    fallbackTitle,
    onClose,
  }: { image: { url: string; name: string } | null; fallbackTitle: string; onClose: () => void } = $props();
</script>

<Dialog.Root open={image !== null} onOpenChange={(open) => !open && onClose()}>
  <Dialog.Content class="max-w-3xl overflow-hidden p-0">
    <Dialog.Title class="sr-only">{image?.name ?? fallbackTitle}</Dialog.Title>
    {#if image}
      <img src={image.url} alt={image.name} class="h-auto w-full" />
    {/if}
  </Dialog.Content>
</Dialog.Root>
