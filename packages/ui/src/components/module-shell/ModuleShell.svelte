<script lang="ts">
  // v3's module shell (reference/src/lib/components/module-shell.svelte), ported once: the one detail shell of the
  // participant map (Objekt detail, cluster detail, create form). On a phone a draggable bottom sheet (peek height,
  // expanded by a tap or drag on the header or a swipe at the edge of the content); from 768 px a 450 px panel on
  // the right. Not modal: the map stays usable, there is no scrim. It slides in and out; it is not unmounted.
  // Better than v3, because nested controls fail axe: the header is not itself a button, a transparent button under
  // the title does the toggling; the closed shell is `inert`, so nothing in it can take focus.
  import { onMount, type Snippet } from 'svelte';
  import { Portal } from 'bits-ui';
  import X from '@lucide/svelte/icons/x';
  import { m } from '../../paraglide/messages.js';
  import { isMobile } from '../../breakpoint/is-mobile';
  import { edgeSwipe } from './edge-swipe';

  interface Props {
    /** The shell is on screen. A closed shell slides out. */
    open: boolean;
    /** Phone only: full height instead of peek. On desktop the panel is always full. */
    expanded?: boolean | undefined;
    title?: string | undefined;
    /** The accessible name of the dialog; the title when not given. */
    label?: string | undefined;
    subtitle?: string | undefined;
    /** Badge text on the title row (v3: e.g. the stage). */
    badge?: string | undefined;
    loading?: boolean | undefined;
    error?: string | null | undefined;
    /** The accessible name of the transparent header button that toggles the height (phone). */
    toggleLabel: string;
    closeLabel?: string | undefined;
    onclose?: (() => void) | undefined;
    /** Horizontal swipe on the header (v3 API; no current caller). */
    onnext?: (() => void) | undefined;
    onprevious?: (() => void) | undefined;
    /** The body. Without it the empty state shows. */
    children?: Snippet | undefined;
    footer?: Snippet | undefined;
    /** Extra buttons in the header, left of the close button. */
    headerActions?: Snippet | undefined;
    /** Replaces the plain title; interactive parts inside must stop the click from reaching the header. */
    titleContent?: Snippet | undefined;
    showHeader?: boolean | undefined;
    /** Phone heights in vh; the cluster detail passes 35 and 75. */
    peekVh?: number | undefined;
    expandedVh?: number | undefined;
    testid?: string | undefined;
  }
  let {
    open,
    expanded = $bindable(false),
    title = m.ui_module_shell_default_title(),
    label,
    subtitle,
    badge,
    loading = false,
    error = null,
    toggleLabel,
    closeLabel = m.ui_close(),
    onclose,
    onnext,
    onprevious,
    children,
    footer,
    headerActions,
    titleContent,
    showHeader = true,
    peekVh = 35,
    expandedVh = 90,
    testid = 'module-shell',
  }: Props = $props();

  const DRAG_PX = 80; // header drag or swipe distance that counts
  const SIDEWAYS_PX = 10;
  const TAP_PX = 10; // a header move shorter than this is still a tap

  const mobile = $derived(isMobile());
  const full = $derived(!mobile || expanded);

  // The slide-in needs the closed state on screen for a frame first.
  let entered = $state(false);
  $effect(() => {
    if (!open) {
      entered = false;
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => (entered = true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  });
  const shown = $derived(open && entered);

  let dialog: HTMLElement | undefined = $state();
  // A closed shell is offscreen but still in the page: nothing in it may take focus.
  $effect(() => {
    dialog?.toggleAttribute('inert', !open);
  });
  // Not modal, but focus goes in on open and back to what opened it on close.
  $effect(() => {
    if (!open || !dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  });

  // Gestures: header drag (down shrinks or closes, up grows) and content edge swipe preview.
  let drag = $state<{ x: number; y: number; dy: number; horizontal: boolean; moved: boolean } | null>(null);
  let preview = $state(0);
  const gesturing = $derived(drag !== null || preview !== 0);
  const offset = $derived(drag !== null && !drag.horizontal ? Math.max(0, drag.dy) : preview);

  const grow = (): void => {
    if (mobile) expanded = true;
  };
  const shrink = (): void => {
    if (!mobile) return;
    if (expanded) expanded = false;
    else close();
  };
  function close(): void {
    expanded = false;
    onclose?.();
  }
  function toggle(): void {
    if (!mobile || !open) return;
    expanded = !expanded;
  }

  let moved = false; // a drag just ended: its click is not a tap
  function down(e: PointerEvent): void {
    if (!mobile || !open || (e.target as Element).closest('button:not([data-toggle])')) return;
    drag = { x: e.clientX, y: e.clientY, dy: 0, horizontal: false, moved: false };
    moved = false;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  // The press only records where a drag starts; nothing happens until it is released (WCAG 2.5.2), so this is an
  // action, not an attribute handler.
  function dragStart(node: HTMLElement): { destroy: () => void } {
    node.addEventListener('pointerdown', down);
    return { destroy: () => node.removeEventListener('pointerdown', down) };
  }
  function move(e: PointerEvent): void {
    if (drag === null) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const horizontal = drag.horizontal || (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SIDEWAYS_PX);
    drag = { ...drag, dy, horizontal, moved: drag.moved || Math.hypot(dx, dy) > TAP_PX };
  }
  function up(e: PointerEvent): void {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (drag === null) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const { horizontal } = drag;
    moved = drag.moved;
    drag = null;
    if (e.type === 'pointercancel') return;
    if (horizontal && Math.abs(dx) > DRAG_PX) {
      if (dx > 0) onprevious?.();
      else onnext?.();
    } else if (dy > DRAG_PX) shrink();
    else if (dy < -DRAG_PX) grow();
  }
  // The click that ends a drag must not also toggle.
  function click(): void {
    if (moved) moved = false;
    else toggle();
  }
  onMount(() => () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  });

  // Escape closes the shell, but one inside a nested dialog (the clearing dialog, a select) closes only that dialog.
  function escape(e: KeyboardEvent): void {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    const nested = (e.target as Element | null)?.closest?.('[role="dialog"],[role="alertdialog"]');
    if (nested && nested !== dialog) return;
    close();
  }

  const classes = $derived(
    [
      'fixed z-[1200] flex flex-col bg-background shadow-xl pointer-events-auto',
      mobile
        ? 'right-0 bottom-0 left-0 w-full rounded-t-xl border-t border-border overflow-visible transition-[height,transform,translate] duration-300 ease-out motion-reduce:duration-0'
        : 'top-14 right-0 h-[calc(100vh-56px)] w-[450px] border-l border-border transition-transform duration-300 ease-out motion-reduce:duration-0',
      mobile ? (shown ? 'translate-y-0' : 'translate-y-full') : shown ? 'translate-x-0' : 'translate-x-full',
      gesturing && 'transition-none',
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<svelte:window onkeydown={escape} />

<!-- Portaled to <body>, so its z-index competes with the other body-portaled overlays and not with a stacking
     context of the page. -->
<Portal to="body">
  <div
    class={classes}
    style:height={mobile ? `${expanded ? expandedVh : peekVh}vh` : undefined}
    style:transform={offset !== 0 ? `translateY(${offset}px)` : undefined}
    data-testid={testid}
    data-state={full ? 'full' : 'peek'}
    data-open={shown}
    role="dialog"
    aria-label={label ?? title}
    aria-hidden={open ? undefined : true}
    tabindex="-1"
    bind:this={dialog}
  >
    {#if mobile}
      <!-- fills the gap under the sheet while it moves up during an expand preview -->
      <div
        class="pointer-events-none absolute right-0 left-0 bg-background"
        style:top="100%"
        style:height="80px"
      ></div>
    {/if}

    {#if showHeader}
      <div
        class="relative flex flex-shrink-0 touch-none items-center justify-between rounded-t-xl border-b border-border bg-primary p-4 text-primary-foreground select-none {mobile
          ? 'cursor-grab'
          : ''} {drag !== null ? 'cursor-grabbing' : ''}"
        use:dragStart
        role="presentation"
      >
        {#if mobile}
          <button
            type="button"
            data-toggle
            class="absolute inset-0 rounded-t-xl"
            aria-label={toggleLabel}
            aria-expanded={expanded}
            onclick={click}
          ></button>
          <div
            class="pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-primary-foreground/40"
          ></div>
        {/if}
        <div class="pointer-events-none relative mt-2 min-w-0 flex-1">
          <div class="flex items-center gap-2">
            {#if titleContent}
              <div class="pointer-events-auto min-w-0">{@render titleContent()}</div>
            {:else}
              <h3 class="truncate text-lg font-semibold">{title}</h3>
            {/if}
            {#if badge}
              <span
                class="inline-flex items-center rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs font-medium"
                data-testid="{testid}-badge">{badge}</span
              >
            {/if}
          </div>
          {#if subtitle}
            <p class="mt-0.5 truncate text-xs opacity-70" data-testid="{testid}-subtitle">{subtitle}</p>
          {/if}
        </div>
        <div class="relative -mt-2 ml-2 flex items-center gap-1">
          {#if headerActions}{@render headerActions()}{/if}
          <button
            type="button"
            class="flex min-h-11 min-w-11 items-center justify-center rounded p-2 transition-colors hover:bg-primary-foreground/10"
            aria-label={closeLabel}
            onclick={close}
          >
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    {/if}

    {#if loading}
      <div class="flex flex-1 items-center justify-center" role="status">
        <div class="text-center">
          <div
            class="mx-auto mb-2 h-8 w-8 animate-spin motion-reduce:animate-none rounded-full border-2 border-primary border-t-transparent"
            aria-hidden="true"
          ></div>
          <p class="text-sm text-muted-foreground">{m.ui_module_shell_loading()}</p>
        </div>
      </div>
    {:else if error}
      <div class="flex flex-1 items-center justify-center p-4" role="alert">
        <div class="text-center">
          <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <X class="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <p class="mb-1 text-sm font-medium text-destructive">{m.ui_module_shell_error()}</p>
          <p class="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    {:else if children}
      <div
        class="min-h-0 flex-1 overflow-y-auto overscroll-none"
        use:edgeSwipe={{ grow, shrink, enabled: mobile && open, expanded, onpreview: (px) => (preview = px) }}
      >
        {@render children()}
      </div>
    {:else}
      <div class="flex flex-1 items-center justify-center">
        <p class="text-sm text-muted-foreground">{m.ui_module_shell_no_content()}</p>
      </div>
    {/if}

    {#if footer && !loading && !error}
      <div class="flex-shrink-0 border-t border-border bg-muted/30">{@render footer()}</div>
    {/if}
  </div>
</Portal>
