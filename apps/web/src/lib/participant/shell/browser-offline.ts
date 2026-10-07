/**
 * The offline map data of an open app in the browser (WP-650, WP-667): the packs on this device, the install state, the
 * storage numbers and the Offline-Bilder switch, which is the person's preference `ui.offline_images`. Split out of
 * `MapScreen.svelte` (400-line rule); tests pass their own `OfflineContext` instead.
 */
import { browserStoragePort, type PrefsClient } from '@ueberblick/client';
import type { Device } from '../device';
import { browserImages, browserOffline } from '../offline/browser';
import type { OfflineContext } from '../offline/context';
import { deviceFeatures, nextTask, scanPhotos } from '../offline/photos';
import { browserPwaEnv, createPwa } from '../offline/pwa';

export function browserOfflineContext(device: Device, prefsClient: PrefsClient): OfflineContext {
  return {
    offline: browserOffline(device.project, device.participant.id, device.fetch),
    pwa: createPwa(browserPwaEnv(window, navigator)),
    storage: browserStoragePort(window),
    images: browserImages({
      fetch: device.fetch,
      project: device.project,
      online: device.network.current,
      participant: device.participant.id,
      prefs: {
        enabled: () => prefsClient.current().ui.offline_images === true,
        set: (on) => {
          prefsClient.set('ui.offline_images', on);
          void prefsClient.sync();
        },
        subscribe: (fn) => prefsClient.subscribe(() => fn()),
      },
      photosInScope: () =>
        scanPhotos({
          features: deviceFeatures(device.store, Object.keys(device.config.file.types ?? {})),
          yieldNow: nextTask,
        }),
    }),
  };
}
