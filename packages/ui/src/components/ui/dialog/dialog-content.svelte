<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import XIcon from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import Overlay from './dialog-overlay.svelte';
  import { provideInsideModal } from './modal-context';
  import { cn, type WithoutChildrenOrChild } from '../../../utils.js';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    showCloseButton = true,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: DialogPrimitive.PortalProps;
    children: Snippet;
    showCloseButton?: boolean;
  } = $props();

  provideInsideModal();
</script>

<DialogPrimitive.Portal {...portalProps}>
  <Overlay />
  <!-- bits-ui sets inline `contain: layout style` (dialog.svelte.js:278), which clips popovers on phones; v3's content had no containment (reference/src/lib/components/ui/dialog/dialog-content.svelte), hence `contain-none!` once here. -->
  <!-- Flexbox centering wrapper - avoids transform which breaks fixed positioning inside -->
  <div class="pointer-events-none fixed inset-0 z-[1400] flex items-center justify-center p-4">
    <DialogPrimitive.Content
      bind:ref
      data-slot="dialog-content"
      class={cn(
        'pointer-events-auto contain-none! relative grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out motion-reduce:animate-none! data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
        className,
      )}
      {...restProps}
    >
      {@render children?.()}
      {#if showCloseButton}
        <DialogPrimitive.Close
          class="absolute end-4 top-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <XIcon />
          <span class="sr-only">{m.ui_close()}</span>
        </DialogPrimitive.Close>
      {/if}
    </DialogPrimitive.Content>
  </div>
</DialogPrimitive.Portal>
