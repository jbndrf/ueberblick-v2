// The thread's scroller: draws only the groups near the viewport (R14), keeps the reader where they are unless they
// are at the bottom (better than v3, which always yanked to the bottom, `ChatSheet.svelte:365-380`), and follows
// the keyboard (the panel's height changes with the visualViewport).
import { createGrouper, type ThreadGroup } from './thread';
import { ESTIMATED_ROW_PX, offsetsOf, windowOf } from './window';
import type { ToolDataItem } from '@ueberblick/ui/tool-api';

/** Within this many px of the end the reader counts as "at the bottom". */
const BOTTOM_SLACK_PX = 24;
/** Used when the scroller has no layout yet (it is not attached or measured). */
const FALLBACK_VIEWPORT_PX = 600;

export interface ThreadList {
  /** New items: groups them and redraws. `follow` scrolls to the newest message even when the reader had scrolled up. */
  update(items: readonly ToolDataItem[], follow: boolean): void;
  destroy(): void;
}

export function createThreadList(
  scroller: HTMLElement,
  self: string,
  draw: (group: ThreadGroup) => HTMLElement,
  emptyText: string,
): ThreadList {
  const inner = document.createElement('div');
  inner.className = 'ub-chat-rows';
  inner.dataset['chat'] = 'rows';
  scroller.append(inner);

  const group = createGrouper(self);
  let groups: readonly ThreadGroup[] = [];
  let heights = new Map<string, number>();
  let offsets = offsetsOf([]);
  let stick = true; // the first draw opens at the newest message

  const nearBottom = (): boolean =>
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_SLACK_PX;
  const heightList = (): number[] => groups.map((g) => heights.get(g.key) ?? ESTIMATED_ROW_PX);

  let shown = { from: -1, to: -1 };
  /** Redraws; a scroll that leaves the same rows in the window keeps them (a focused chip stays focused). */
  function paint(force = true, atBottom = false): void {
    const viewport = scroller.clientHeight || FALLBACK_VIEWPORT_PX;
    // at the bottom the window is the one around the end, whatever the scroller still shows (its spacers are the old ones)
    const top = (): number =>
      atBottom ? Math.max(0, (offsets[offsets.length - 1] as number) - viewport) : scroller.scrollTop;
    let w = windowOf(offsets, top(), viewport);
    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ub-chat-empty';
      empty.textContent = emptyText;
      inner.style.paddingTop = inner.style.paddingBottom = '';
      inner.replaceChildren(empty);
      shown = { from: -1, to: -1 };
      return;
    }
    if (!force && w.from === shown.from && w.to === shown.to) return;
    for (let pass = 0; pass < 2; pass++) {
      shown = { from: w.from, to: w.to };
      const rows = groups.slice(w.from, w.to).map(draw);
      inner.style.paddingTop = `${w.before}px`;
      inner.style.paddingBottom = `${w.after}px`;
      inner.replaceChildren(...rows);
      let changed = false;
      rows.forEach((row, i) => {
        const h = row.offsetHeight; // 0 without layout: the estimate stands
        const key = (groups[w.from + i] as ThreadGroup).key;
        if (h > 0 && heights.get(key) !== h) {
          heights.set(key, h);
          changed = true;
        }
      });
      if (!changed) return;
      offsets = offsetsOf(heightList());
      w = windowOf(offsets, top(), viewport);
    }
  }

  function toBottom(): void {
    paint(true, true); // the window around the end, with the heights it measured
    scroller.scrollTop = scroller.scrollHeight;
  }

  const onScroll = (): void => {
    stick = nearBottom();
    paint(false);
  };
  const onSize = (): void => (stick ? toBottom() : paint());
  scroller.addEventListener('scroll', onScroll);
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onSize);
  observer?.observe(scroller);
  const onResize = (): void => {
    heights = new Map(); // another width wraps the text differently
    offsets = offsetsOf(heightList());
    onSize();
  };
  window.addEventListener('resize', onResize);

  return {
    update(items, follow) {
      const wasAtBottom = stick;
      groups = group(items);
      offsets = offsetsOf(heightList());
      if (wasAtBottom || follow) {
        stick = true;
        toBottom();
      } else paint();
    },
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      inner.remove();
    },
  };
}
