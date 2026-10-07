// With no camera the map opens on the extent of the features the view delivers (v3 MapCanvas fitBounds over the
// project's features on open). A large view arrives in slices (WP-847), so the fit follows the union of the slices
// until a quiet gap (`FIT_SETTLE_MS` without an add) ends it or the person moves the map. The data also arrives in
// chunks while the device loads (about a second apart for 4000 runs), so the gap is long. It refits only when the union
// grows: a filter change re-adds known features inside it and never moves the map.
import type { Bbox } from '@ueberblick/core/geo';
import type { MapFeature } from '../contract';
import { anchorsExtent, unionBox } from './renderer-util';

/** How long without a new `add` ends the start fit. */
export const FIT_SETTLE_MS = 5000;

export interface StartFit {
  /** One delivery's adds: fits (or widens the fit to) the union of what the view delivered so far. */
  feed(adds: readonly MapFeature[]): void;
  /** A new no-camera view fits its own first delivery. */
  reset(): void;
  /** Ends the fit window (the person moved the map, or the renderer is destroyed). */
  close(): void;
}

/** `centre` moves the map (`jump` for a refit, which does not animate); `active` is false with a camera or before the map exists. */
export function createStartFit(
  centre: (box: Bbox, jump: { duration?: number }) => void,
  active: () => boolean,
): StartFit {
  let box: Bbox | undefined;
  let fitted = false;
  let open = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = (): void => {
    open = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    feed(adds) {
      if (adds.length === 0 || !active() || (fitted && !open)) return;
      const next = anchorsExtent(adds);
      if (next === undefined) return; // no finite anchor: a later delivery can fit
      const grown = box === undefined ? next : unionBox(box, next);
      const same = box !== undefined && grown.every((v, i) => v === box?.[i]);
      box = grown;
      if (!same) centre(box, fitted ? { duration: 0 } : {});
      fitted = true;
      open = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(close, FIT_SETTLE_MS);
    },
    reset() {
      fitted = false;
      box = undefined;
      close();
    },
    close,
  };
}
