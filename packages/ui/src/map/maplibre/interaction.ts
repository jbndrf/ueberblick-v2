// Double-click zoom on or off (v3 turned it off while drawing, `geometry-draw-tool.svelte:207`): two quick taps must add
// two vertices, not zoom. The wish is kept until the map exists, so a call before the load still counts.
import type { MlMap } from './api';

export interface DoubleClickSwitch {
  set(on: boolean): void;
  /** Applies the wish to a loaded map. */
  attach(map: MlMap): void;
}

export function createDoubleClickSwitch(): DoubleClickSwitch {
  let on = true;
  let map: MlMap | undefined;
  const apply = (): void => {
    if (on) map?.doubleClickZoom.enable();
    else map?.doubleClickZoom.disable();
  };
  return {
    set(next) {
      on = next;
      apply();
    },
    attach(m) {
      map = m;
      if (!on) apply();
    },
  };
}
