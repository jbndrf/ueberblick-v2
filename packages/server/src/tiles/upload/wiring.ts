import { join } from 'node:path';
import { assertProjectKey } from '../../db/open';
import { createTileUploads, type TileUploads } from './service';
import { createDiskStore } from './store';
import { sweepStaleUploads } from './sweep';

/** Where the archives of a project live: `<dataDir>/blobs/tiles/<project>` (A-044). */
export const tilesDir = (dataDir: string, projectKey: string): string => {
  assertProjectKey(projectKey);
  return join(dataDir, 'blobs', 'tiles', projectKey);
};

export interface TileUploadRuntime {
  /** `<dataDir>/blobs/tiles/<project>` (`tilesDir(dataDir, key)`, set by the runtime). */
  tilesDir(projectKey: string): string;
  readonly clock: { now(): string };
}

const shared = new WeakMap<object, TileUploads>();

const storeFor = (rt: TileUploadRuntime) => createDiskStore((project) => rt.tilesDir(project));

/** Startup sweep of a runtime: removes uploads that were left `receiving` for too long (`sweepStaleUploads`). */
export function sweepStaleTileUploads(
  rt: TileUploadRuntime,
  projects: readonly string[],
  onError: (project: string, id: string | undefined) => void,
): number {
  return sweepStaleUploads({ store: storeFor(rt), now: () => rt.clock.now(), onError }, projects);
}

/** The one upload engine of a runtime, memoised on it: the admin routes and the archive route share it. */
export function tileUploadsFor(rt: TileUploadRuntime): TileUploads {
  let uploads = shared.get(rt);
  if (uploads === undefined) {
    uploads = createTileUploads({
      store: storeFor(rt),
      now: () => rt.clock.now(),
    });
    shared.set(rt, uploads);
  }
  return uploads;
}
