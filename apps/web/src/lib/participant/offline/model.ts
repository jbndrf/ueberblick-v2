// The device's offline map data as the app binds it (WP-650): one pack manager, the tile protocol the map reads it
// through, and the list of packs the server offers. Headless: the storage and the transport are ports, so the tab
// and the map run under test with a memory store and a fake server.
import {
  createPackManager,
  type PackManager,
  type PackManifestEntry,
  type PackStorage,
  type PackTransport,
} from '@ueberblick/client';
import { createPackProtocol, type PackRouting } from '@ueberblick/ui';

export interface OfflineDeps {
  readonly storage: PackStorage;
  readonly transport: PackTransport;
}

export type PackListing =
  | { readonly ok: true; readonly packs: readonly PackManifestEntry[] }
  | { readonly ok: false; readonly reason: string };

export interface Offline {
  /** False on a browser without OPFS: the map keeps using the network and the tab says so. */
  readonly supported: boolean;
  readonly manager: PackManager;
  /** Handed to the renderer; a layer with a pack on the device is read from it. Valid after `ready`. */
  readonly packProtocol: PackRouting;
  /** The index is read: the map may mount (its basemaps are routed once, by what is on the device). */
  readonly ready: Promise<void>;
  /** The packs the server offers now (A-032 manifest); the selector's list. */
  list(): Promise<PackListing>;
}

export function createOffline(deps: OfflineDeps): Offline {
  const manager = createPackManager(deps);
  return {
    supported: manager.supported,
    manager,
    packProtocol: createPackProtocol({ packs: manager.files, hasLayer: manager.hasLayer }),
    ready: manager.load().catch(() => undefined), // an unreadable index is an empty device, not a blocked map
    list: () => manager.refresh(),
  };
}
