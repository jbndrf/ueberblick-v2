<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';
  export const sheetVariants = tv({
    base: 'bg-background data-[state=open]:animate-in motion-reduce:animate-none! data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
    variants: {
      side: {
        // Mobile: top-14 (below header), bottom-16 (above nav bar)
        // Desktop (md+): top-14, bottom-0 (full height below header)
        left: 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left left-0 top-14 bottom-16 md:bottom-0 w-3/4 border-r sm:max-w-sm',
        right:
          'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right right-0 top-14 bottom-16 md:bottom-0 w-3/4 border-l sm:max-w-sm',
      },
    },
    defaultVariants: {
      side: 'left',
    },
  });

  export type Side = VariantProps<typeof sheetVariants>['side'];
</script>

<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { Dialog as SheetPrimitive } from 'bits-ui';
  import XIcon from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import { cn, type WithoutChildrenOrChild } from '../../../utils.js';
  import { onMount } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    side = 'left',
    portalProps,
    closeLabel,
    children,
    ...restProps
  }: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
    portalProps?: SheetPrimitive.PortalProps;
    /** The screen-reader name of the close button; an app that switches language at runtime passes it (WP-790). */
    closeLabel?: string;
    side?: Side;
    children: Snippet;
  } = $props();

  // Click vs drag detection - only close on click, not drag
  let mouseDownPos: { x: number; y: number } | null = null;
  const CLICK_THRESHOLD = 5;

  onMount(() => {
    function handleMouseDown(e: MouseEvent | TouchEvent) {
      const pos = 'touches' in e ? e.touches[0] : e;
      if (pos === undefined) return;
      mouseDownPos = { x: pos.clientX, y: pos.clientY };
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('touchstart', handleMouseDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('touchstart', handleMouseDown);
    };
  });

  function handleInteractOutside(e: Event) {
    // Check if this was a click (small movement) or a drag (large movement)
    if (mouseDownPos) {
      const mouseEvent = e as MouseEvent;
      const deltaX = Math.abs(mouseEvent.clientX - mouseDownPos.x);
      const deltaY = Math.abs(mouseEvent.clientY - mouseDownPos.y);

      // If it was a drag (not a click), prevent closing
      if (deltaX > CLICK_THRESHOLD || deltaY > CLICK_THRESHOLD) {
        e.preventDefault();
        return;
      }
    }
    // Otherwise allow the default close behavior (it was a click)
  }
</script>

<SheetPrimitive.Portal {...portalProps}>
  <!-- NO OVERLAY - allows map interaction while sheet is open -->
  <SheetPrimitive.Content
    bind:ref
    data-slot="sheet-content"
    class={cn(sheetVariants({ side }), className)}
    onInteractOutside={handleInteractOutside}
    {...restProps}
  >
    {@render children?.()}
    <SheetPrimitive.Close
      class="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none"
    >
      <XIcon class="size-4" />
      <span class="sr-only">{closeLabel ?? m.ui_close()}</span>
    </SheetPrimitive.Close>
  </SheetPrimitive.Content>
</SheetPrimitive.Portal>
