// The pointer cursor over a tappable feature (v3 `MapCanvas.svelte:1085-1090`): `cursor: pointer` while the mouse is over
// a feature or cluster, the default again when it leaves. A layer is listened to once, however often the layers are redrawn
// (MapLibre keeps a layer-bound listener by id). Several layers can be under the pointer, so the cursor follows the count.
import type { MlMap } from './api';

export interface Hover {
  /** Listens on the layers not yet listened to. */
  watch(map: MlMap, layerIds: Iterable<string>): void;
}

export function createHover(): Hover {
  const watched = new Set<string>();
  const over = new Set<string>();
  return {
    watch(map, layerIds) {
      for (const id of layerIds) {
        if (watched.has(id)) continue;
        watched.add(id);
        const show = (): void => {
          map.getCanvas().style.cursor = over.size > 0 ? 'pointer' : '';
        };
        map.on('mouseenter', id, () => {
          over.add(id);
          show();
        });
        map.on('mouseleave', id, () => {
          over.delete(id);
          show();
        });
      }
    },
  };
}
