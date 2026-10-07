/**
 * What the sync worker needs from this app (WP-567): the page transport and the clock, built inside the worker from
 * the plain-string `config` of the `init` message (functions cannot be posted). The entry, `sync.worker.ts`, is one
 * line around this factory, so the factory runs under test on a MessageChannel.
 */
import type { IdbEnv, WorkerSideFactory } from '@ueberblick/client';
import { decodingTransport, inlineDecoder } from '@ueberblick/client';
import type { Instant } from '@ueberblick/core/model';
import type { FetchLike } from './http';
import { sessionGuard } from './session-guard';
import { createEncodedSyncTransport } from './sync-transport';

/** The settings the worker is started with. */
export const WORKER_CONFIG_PROJECT = 'project';
/** The participant the device works as: the worker's sync requests are guarded against a turned session (WP-768). */
export const WORKER_CONFIG_PARTICIPANT = 'participant';

export interface WorkerSidePorts {
  readonly fetch: FetchLike;
  readonly env: IdbEnv;
  readonly now: () => Instant;
}

export function createWorkerSide(ports: WorkerSidePorts): WorkerSideFactory {
  return (init) => {
    const project = init.config[WORKER_CONFIG_PROJECT];
    if (project === undefined || project === '')
      throw new Error('The sync worker was started without a project.');
    const participant = init.config[WORKER_CONFIG_PARTICIPANT];
    if (participant === undefined || participant === '')
      throw new Error('The sync worker was started without a participant.');
    const guarded = sessionGuard(ports.fetch, participant);
    return {
      env: ports.env,
      // the page is decoded here, in the worker; only the applied page crosses to the main thread
      transport: decodingTransport(createEncodedSyncTransport(project, guarded), inlineDecoder),
      clock: { now: ports.now },
    };
  };
}
