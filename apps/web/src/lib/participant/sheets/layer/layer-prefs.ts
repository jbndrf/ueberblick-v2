/**
 * Where the Kartenlayer choice lives: the person's preference record (WP-612, key `ui.map_layers`), so it follows them
 * to another device. Owner Q3 keeps only the tile pack, install, Offline-Bilder and the remembered tab on the device.
 */
import type { PrefsClient } from '@ueberblick/client';
import type { MapSelection } from '@ueberblick/core/registry';

export const MAP_LAYERS_PREF = 'ui.map_layers';

/** What the controller needs of the record: read the choice, write it, and hear a change (a sync from the server). */
export interface LayerChoiceStore {
  read(): MapSelection | undefined;
  write(selection: MapSelection): void;
  subscribe(listener: () => void): () => void;
}

export function prefsLayerChoice(
  client: Pick<PrefsClient, 'current' | 'set' | 'subscribe'>,
): LayerChoiceStore {
  return {
    read() {
      const v = client.current().ui.map_layers;
      return v === undefined ? undefined : { base: v.base ?? undefined, overlays: [...v.overlays] };
    },
    write: (s) => client.set(MAP_LAYERS_PREF, { base: s.base ?? null, overlays: [...s.overlays] }),
    subscribe: (listener) => client.subscribe(() => listener()),
  };
}
