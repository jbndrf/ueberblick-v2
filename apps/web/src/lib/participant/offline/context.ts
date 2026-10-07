// What the map screen gives the Offline tab and the download card (WP-650): the one `Offline` of the open app, the
// install state (it must listen from the start, see `pwa.ts`) and the browser's storage numbers.
import type { OfflineImages } from './images';
import type { Offline } from './model';
import type { Pwa } from './pwa';

export interface StorageNumbers {
  persisted(): Promise<boolean>;
  estimate(): Promise<{ readonly usage: number; readonly quota: number } | undefined>;
}

export interface OfflineContext {
  readonly offline: Offline;
  readonly pwa: Pwa;
  /** Offline-Bilder: the thumbnails kept for photos (WP-667). */
  readonly images: OfflineImages;
  readonly storage: StorageNumbers;
}
