/**
 * The Liste's row-drawing strategy (WP-862): a table draws its first rows and appends the next batch as the person
 * scrolls near the end or keyboard focus reaches the last drawn row. The data stays complete (sort, counts); only the
 * DOM is incremental. True windowing or paging replaces this one module (the component asks only `first`, `more` and
 * `nearEnd`).
 */
export const BATCH = 100;

/** How many rows a table draws first. */
export const first = (total: number): number => Math.min(total, BATCH);

/** How many rows are drawn after one more batch. */
export const more = (drawn: number, total: number): number => Math.min(total, drawn + BATCH);

/** Calls `onNear` whenever the node comes into (or near) view of its scroll container; a no-op without IntersectionObserver. */
export function nearEnd(node: HTMLElement, onNear: () => void): { destroy: () => void } {
  if (typeof IntersectionObserver === 'undefined') return { destroy: () => undefined };
  const watcher = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) onNear();
    },
    { rootMargin: '600px 0px' },
  );
  watcher.observe(node);
  return { destroy: () => watcher.disconnect() };
}
