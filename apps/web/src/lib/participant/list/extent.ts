import type { Bbox } from '@ueberblick/core/geo';

/** Share of the span added on each side: a marker on the edge of the view, or a rounding step off it, is still listed. */
const MARGIN = 0.05;

export function padExtent([w, s, e, n]: Bbox): Bbox {
  const dx = (e - w) * MARGIN;
  const dy = (n - s) * MARGIN;
  return [w - dx, s - dy, e + dx, n + dy];
}

const usable = ([w, s, e, n]: Bbox): boolean => e > w && n > s;

/**
 * The extent the Liste filters by. A map hidden behind the Liste is resized to nothing and reports a point, which would
 * empty the Liste (WP-711), so the last extent seen while the map was visible and sized is kept instead.
 */
export function createExtentHold(): {
  read(live: () => Bbox | undefined, mapHidden: boolean): Bbox | undefined;
} {
  let held: Bbox | undefined;
  return {
    read(live, mapHidden) {
      if (!mapHidden) {
        const now = live();
        if (now !== undefined && usable(now)) held = padExtent(now);
      }
      return held;
    },
  };
}
