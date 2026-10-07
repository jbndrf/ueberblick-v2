/** The device-side wiring of the participant screen that has no view of its own: photo URLs and the status feeds. */
import {
  createPrefsClient,
  httpPrefsTransport,
  webKeyValueStorage,
  type PrefsClient,
  type QueueStatus,
  type SyncStatus,
} from '@ueberblick/client';
import { providePhotoUrl } from '@ueberblick/ui';
import type { Device } from '../device';
import type { OfflineContext } from '../offline/context';
import { createPhotoUrl } from '../photo-url';
import type { AppProblem } from '../notices';

/** Every photo of the form and of Daten resolves through one function; returns the stop (disposes it). */
export function providePhotoOf(dev: Device, offline: OfflineContext): () => void {
  const photoUrl = createPhotoUrl({
    project: dev.project,
    pending: dev.blobs,
    stored: { has: (sha) => dev.store.blobs.has(sha), getBlob: (sha) => dev.store.getBlob(sha) },
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    thumbs: offline.images.cache,
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  });
  providePhotoUrl(photoUrl);
  return () => photoUrl.dispose();
}

export interface StatusSinks {
  queue: (s: QueueStatus) => void;
  sync: (s: SyncStatus) => void;
  problems: (p: readonly AppProblem[]) => void;
  online: (on: boolean) => void;
}

/** Feeds the queue, sync, problem and network state to the screen; returns the stop. */
export function bindDeviceStatus(
  device: Device,
  offline: OfflineContext,
  prefsClient: Pick<PrefsClient, 'sync'>,
  sinks: StatusSinks,
): () => void {
  const stops: (() => void)[] = [];
  let seen = '';
  const first = device.sync.worker.status();
  seen = `${first.featuresLoaded}/${first.lastSyncedSeq}`; // a delta moves only the seq
  stops.push(
    device.queue.subscribe(sinks.queue),
    device.sync.worker.subscribe((s) => {
      sinks.sync(s);
      if (s.phase === 'idle' && `${s.featuresLoaded}/${s.lastSyncedSeq}` !== seen) {
        seen = `${s.featuresLoaded}/${s.lastSyncedSeq}`;
        void offline.images.refresh();
      }
    }),
    device.problems.subscribe(sinks.problems),
  );
  sinks.problems(device.problems.list()); // the map (a child) may have reported before this subscription
  stops.push(
    device.network.subscribe((now) => {
      sinks.online(now);
      if (!now) return;
      void prefsClient.sync();
      void offline.images.refresh();
    }),
  );
  return () => stops.forEach((s) => s());
}

/** The person's preference record on this device: cached in localStorage, synced over HTTP. */
export const devicePrefsClient = (dev: Device): PrefsClient =>
  createPrefsClient({
    storage: webKeyValueStorage(localStorage),
    transport: httpPrefsTransport(dev.project, dev.fetch as typeof fetch),
    clock: dev.clock,
    project: dev.project,
    participant: dev.participant.id,
  });

/** The project icon is a blob of the project (WP-611); the route serves it to a signed-in participant. */
export const projectIconUrl = (device: Device): string | undefined =>
  device.identity.project.icon === null
    ? undefined
    : `/api/p/${device.project}/blobs/${device.identity.project.icon}`;
