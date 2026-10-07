import type { Clock } from '@ueberblick/core';
import { join } from 'node:path';
import type { BlobStore } from '../../blobs';
import { createThumbnails, type Thumbnails } from '../../blobs/thumbs';
import type { Logger } from '../../log';
import type { Db } from '../../db/driver';
import type { ConfigResolver } from '../../store/run/config-for';
import type { DeployedConfig, SyncService } from '../../sync';
import type { BlobLimits, ProjectAccessDeps } from '../shared/contract';
import { createBlobHandlers, type BlobHandlers } from './handlers';

/** What `blobHandlersFor` reads from a runtime (`Runtime` in apps/web satisfies it structurally). */
export interface BlobRuntimeDeps extends ProjectAccessDeps {
  readonly clock: Clock;
  readonly log: Logger;
  projectDb(key: string): Db;
  /** The data folder; thumbnails go to `<dataDir>/blobs/<project>/thumbs`. Required: a runtime without it would answer every `?thumb` with 404 (WP-708). */
  readonly dataDir: string;
  readonly blobs: { store(projectKey: string): BlobStore };
  readonly services: {
    deployed(projectKey: string): DeployedConfig | undefined;
    sync(projectKey: string): Pick<SyncService, 'versions'>;
  };
  /** Upload limit override (default `DEFAULT_BLOB_LIMITS`). */
  readonly blobLimits?: Partial<BlobLimits>;
}

const shared = new WeakMap<object, BlobHandlers>();

/** The blob handlers of a runtime, memoised on it. Route files delegate here (`blobHandlersFor(runtime()).put`). */
export function blobHandlersFor(rt: BlobRuntimeDeps): BlobHandlers {
  let handlers = shared.get(rt);
  if (handlers === undefined) {
    const { dataDir } = rt;
    const made = new Map<string, Thumbnails>();
    handlers = createBlobHandlers({
      thumbs: (k: string) => {
        let t = made.get(k);
        if (t === undefined) made.set(k, (t = createThumbnails(join(dataDir, 'blobs', k, 'thumbs'))));
        return t;
      },
      auth: rt.auth,
      project: (k) => rt.project(k),
      clock: rt.clock,
      log: rt.log,
      projectDb: (k) => rt.projectDb(k),
      store: (k) => rt.blobs.store(k),
      deployed: (k) => rt.services.deployed(k),
      versions: (k): ConfigResolver => rt.services.sync(k).versions,
      ...(rt.blobLimits ? { limits: rt.blobLimits } : {}),
    });
    shared.set(rt, handlers);
  }
  return handlers;
}
