// The platform behind `createOffline`: OPFS for the bytes, `fetch` for the manifest and the downloads. Where the main
// thread cannot write OPFS files (Safari), a small dedicated worker does the writes (`pack-writer.worker.ts`); the
// manager and the map protocol stay on this thread. Thin on purpose; the browser e2e exercises it.
import {
  deviceOpfsStorage,
  fetchThumbTransport,
  idbThumbCache,
  type IdbEnv,
  fetchPackTransport,
  mainThreadCanWrite,
  workerPackWriter,
  type WriterPort,
} from '@ueberblick/client';
import { thumbsName } from '../device-names';
import type { FetchLike } from '../http';
import { createOfflineImages, type ImagesPrefs, type OfflineImages } from './images';
import { createOffline, type Offline } from './model';

/** `fetch` is the device's guarded one (WP-768): a turned session stops the downloads. */
export function browserOffline(project: string, participant: string, fetch: FetchLike): Offline {
  const scope = { project, participant };
  const writer = mainThreadCanWrite(globalThis as never)
    ? undefined
    : workerPackWriter(
        // The literal `new URL(…, import.meta.url)` is what makes Vite bundle the worker (and the build list precache it);
        // the scope therefore travels in the worker's name, not in a URL query (WP-791).
        new Worker(new URL('./pack-writer.worker.ts', import.meta.url), {
          type: 'module',
          name: new URLSearchParams(scope).toString(),
        }) as unknown as WriterPort,
      );
  return createOffline({
    storage: deviceOpfsStorage(navigator, scope, writer),
    transport: fetchPackTransport(project, (url, init) =>
      fetch(url, {
        ...(init?.headers === undefined ? {} : { headers: init.headers }),
        ...(init?.signal === undefined ? {} : { signal: init.signal }),
      }),
    ),
  });
}

/** Offline-Bilder on this device: the thumbnails sit in a small IndexedDB of their own, per project and person. */
export function browserImages(deps: {
  readonly fetch: FetchLike;
  readonly project: string;
  readonly participant: string;
  readonly prefs: ImagesPrefs;
  readonly photosInScope: () => Promise<readonly string[]>;
  /** The server answers (WP-734). */
  readonly online: () => boolean;
}): OfflineImages {
  const env =
    typeof indexedDB === 'undefined'
      ? undefined
      : ({ factory: indexedDB, keyRange: IDBKeyRange } as unknown as IdbEnv);
  return createOfflineImages({
    cache: idbThumbCache(env, thumbsName(deps.project, deps.participant)),
    transport: fetchThumbTransport(deps.project, (url, init) =>
      deps.fetch(url, {
        ...(init?.signal === undefined ? {} : { signal: init.signal }),
      }),
    ),
    prefs: deps.prefs,
    photosInScope: deps.photosInScope,
    online: deps.online,
  });
}
