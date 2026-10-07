// The two gestures v3's gallery adds around Embla (MediaGallery.svelte:140-222): a mouse wheel scrolls the strip, and
// a horizontal swipe does too, because Chrome mobile makes `touchmove` non-cancelable inside scroll containers and
// Embla's own drag then fails. The carousel is also re-initialised once it gets a width (a field on a hidden tab
// panel measures 0 until shown; v3 uses ResizeObserver because IntersectionObserver fails in transformed containers).
import type { CarouselAPI } from '../../components/ui/carousel/context';

/** Horizontal distance (px) a swipe must pass, and must exceed the vertical one. v3 :222. */
export const SWIPE_MIN_PX = 30;
/** One wheel notch moves one slide; further notches within this window are ignored. v3 :185. */
export const WHEEL_PAUSE_MS = 300;

export type SwipeDirection = 'prev' | 'next' | null;

/** The pure decision of v3's `handleSwipeEnd`: which way a touch from `start` to `end` scrolls, if any. */
export function swipeDirection(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SwipeDirection {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_MIN_PX) return dx > 0 ? 'prev' : 'next';
  return null;
}

/** Svelte action: wheel, swipe and re-init for the carousel `api` (a no-op until the API exists). */
export function carouselGestures(el: HTMLElement, initial: CarouselAPI | undefined) {
  let api = initial;
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;
  let start = { x: 0, y: 0 };
  let startIndex = 0;
  let reinitialised = false;

  const onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (!t) return;
    start = { x: t.clientX, y: t.clientY };
    startIndex = api?.selectedScrollSnap() ?? 0;
  };
  const onTouchEnd = (e: TouchEvent): void => {
    const t = e.changedTouches[0];
    if (!api || !t) return;
    // Embla already handled this gesture (Firefox, desktop): do nothing.
    if (api.selectedScrollSnap() !== startIndex) return;
    const dir = swipeDirection(start, { x: t.clientX, y: t.clientY });
    if (dir === 'prev') api.scrollPrev();
    else if (dir === 'next') api.scrollNext();
  };
  const onWheel = (e: WheelEvent): void => {
    if (!api) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta === 0) return;
    const forward = delta > 0;
    if (forward ? !api.canScrollNext() : !api.canScrollPrev()) return;
    e.preventDefault();
    if (wheelTimer) return;
    if (forward) api.scrollNext();
    else api.scrollPrev();
    wheelTimer = setTimeout(() => (wheelTimer = null), WHEEL_PAUSE_MS);
  };

  const ro =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver((entries) => {
          if (reinitialised || !api) return;
          if ((entries[0]?.contentRect.width ?? 0) > 0) {
            reinitialised = true;
            api.reInit();
            ro?.disconnect();
          }
        });
  ro?.observe(el);

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('wheel', onWheel, { passive: false });
  return {
    update(next: CarouselAPI | undefined) {
      api = next;
      // The observer reports once on `observe`: re-observe so a width that was already there is seen with the API.
      if (next && !reinitialised && ro) {
        ro.unobserve(el);
        ro.observe(el);
      }
    },
    destroy() {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      ro?.disconnect();
      if (wheelTimer) clearTimeout(wheelTimer);
    },
  };
}
