/**
 * Where a Zuletzt row flies to (v3 `handleRecentInstanceTap`, `+page.svelte:2420-2437`): zoom in to at least street
 * level, and put the Objekt in the middle of the part of the map that the sheets leave free.
 *  - desktop: the detail panel is 450 px on the right, and Zuletzt (256 px) sits left of it while it is open;
 *  - phone: the detail peeks from the bottom (35 % of the height), and Zuletzt (224 px) covers the right edge.
 */
import type { CenterOptions } from '@ueberblick/ui';

/** v3 `toMapZoom(17)`: 17 in its 256 px tile numbering, 16 in MapLibre's 512 px one. */
export const RECENT_MIN_ZOOM = 16;
export const DETAIL_PANEL_PX = 450;
export const RECENT_PANEL_PX = 256;
export const RECENT_PANEL_PHONE_PX = 224;
export const PEEK_RATIO = 0.35;

export function recentFly(opts: {
  readonly phone: boolean;
  readonly innerHeight: number;
  readonly recentOpen: boolean;
}): CenterOptions {
  const right = opts.phone
    ? opts.recentOpen
      ? RECENT_PANEL_PHONE_PX
      : 0
    : DETAIL_PANEL_PX + (opts.recentOpen ? RECENT_PANEL_PX : 0);
  const bottom = opts.phone ? Math.round(opts.innerHeight * PEEK_RATIO) : 0;
  return { minZoom: RECENT_MIN_ZOOM, offset: { right, bottom } };
}
