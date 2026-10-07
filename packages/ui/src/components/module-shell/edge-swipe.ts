/**
 * v3's content-edge swipe (module-shell.svelte `scrollableContent`): at the bottom edge of the content a swipe up
 * grows the sheet; at the top edge a swipe down shrinks it (or closes it from peek). A swipe that scrolled the
 * content, or that is mostly sideways, is the content's own. While such a swipe is under way the sheet follows the
 * finger a little (`onpreview`, 40 % of the move, at most 66 px).
 */
import type { Action } from 'svelte/action';

export interface EdgeSwipe {
  readonly grow: () => void;
  readonly shrink: () => void;
  readonly enabled: boolean;
  /** Already at full height: a swipe up at the bottom edge then does nothing. */
  readonly expanded: boolean;
  /** The preview offset in px (negative moves the sheet up); 0 when there is none. */
  readonly onpreview: (offset: number) => void;
}

export const SWIPE_PX = 110;
export const PREVIEW_MAX_PX = 66;
const PREVIEW_RATIO = 0.4;
const EDGE_PX = 5;
const SIDEWAYS_PX = 10;
const CANCEL_PX = 20;

interface Touch {
  x: number;
  y: number;
  top: boolean;
  bottom: boolean;
  scroll: number;
  scrolled: boolean;
}

/** The sheet's preview offset for a swipe of `delta` px from an edge; 0 when that edge has no gesture. */
export function previewOffset(delta: number, top: boolean, bottom: boolean, expanded: boolean): number {
  if (top && delta > 0) return Math.min(PREVIEW_MAX_PX, delta * PREVIEW_RATIO);
  if (bottom && delta < 0 && !expanded) return Math.max(-PREVIEW_MAX_PX, delta * PREVIEW_RATIO);
  return 0;
}

export const edgeSwipe: Action<HTMLElement, EdgeSwipe> = (node, initial) => {
  let params = initial;
  let t: Touch | null = null;
  let lastY = 0;

  const edges = (): { top: boolean; bottom: boolean } => ({
    top: node.scrollTop <= EDGE_PX,
    bottom: node.scrollTop + node.clientHeight >= node.scrollHeight - EDGE_PX,
  });
  const stop = (): void => {
    t = null;
    params.onpreview(0);
  };
  const onstart = (e: TouchEvent): void => {
    const p = e.touches[0];
    if (!params.enabled || p === undefined) return;
    t = { x: p.clientX, y: p.clientY, scroll: node.scrollTop, scrolled: false, ...edges() };
    lastY = p.clientY;
  };
  const onmove = (e: TouchEvent): void => {
    const p = e.touches[0];
    if (t === null || p === undefined) return;
    const dx = p.clientX - t.x;
    const dy = p.clientY - t.y;
    // sideways: the gesture belongs to the children (a carousel)
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SIDEWAYS_PX) return stop();
    lastY = p.clientY;
    if (node.scrollTop !== t.scroll) t.scrolled = true;
    if (t.scrolled) return params.onpreview(0);
    const { top, bottom } = edges();
    if (
      e.cancelable &&
      ((t.top && top && dy > CANCEL_PX) || (t.bottom && bottom && dy < -CANCEL_PX && !params.expanded))
    )
      e.preventDefault();
    params.onpreview(previewOffset(dy, t.top && top, t.bottom && bottom, params.expanded));
  };
  const onend = (): void => {
    if (t === null) return;
    const delta = lastY - t.y;
    const done = t;
    stop();
    if (done.scrolled || node.scrollTop !== done.scroll) return;
    const { top, bottom } = edges();
    if (done.top && top && delta > SWIPE_PX) params.shrink();
    else if (done.bottom && bottom && delta < -SWIPE_PX && !params.expanded) params.grow();
  };

  node.addEventListener('touchstart', onstart, { passive: true });
  // not passive: preventDefault keeps the page from scrolling under a sheet swipe
  node.addEventListener('touchmove', onmove, { passive: false });
  node.addEventListener('touchend', onend, { passive: true });
  node.addEventListener('touchcancel', stop, { passive: true });
  return {
    update: (next) => {
      params = next;
    },
    destroy: () => {
      node.removeEventListener('touchstart', onstart);
      node.removeEventListener('touchmove', onmove);
      node.removeEventListener('touchend', onend);
      node.removeEventListener('touchcancel', stop);
    },
  };
};
