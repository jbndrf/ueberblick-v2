/** Test helpers for the sync HTTP handlers: a project over an in-memory database, principals and a bell. */
import { createGeo, type Actor, type Key } from '@ueberblick/core';
import type { Principal } from '../../auth';
import type { Store } from '../../store';
import { logSpy, type LogSpy } from '../../store/run/log.testkit';
import { anna as annaActor, golden, IDS, seedMusterstadt } from '../../store/run/testkit';
import { createVersionCache } from '../../store/run/config-for';
import { createDoorbell, createSyncService, withDoorbell, type Doorbell } from '../../sync';
import { syncSetup, type SyncCtx } from '../../sync/testkit';
import { createToolBell, type ToolBell } from '../../modules/chat/tool-bell';
import { createSyncHandlers, type SyncHandlers } from './handlers';

export { decodePage } from '@ueberblick/core';
export { annaActor as anna, IDS };

export interface Http {
  readonly ctx: SyncCtx;
  readonly handlers: SyncHandlers;
  readonly bell: Doorbell;
  readonly toolBell: ToolBell;
  /** The run store; accepted runs ring the bell. */
  readonly store: Store;
  readonly anna: Principal;
  readonly annaActor: Actor;
  /** The log lines the sync handlers wrote. */
  readonly logs: LogSpy;
}

export interface HttpOptions {
  readonly deployed?: boolean;
  readonly heartbeatMs?: number;
}

export function setupHttp(opts: HttpOptions = {}): Http {
  const config = golden('musterstadt-plain');
  const ctx = syncSetup(config);
  seedMusterstadt(ctx);
  const deployed = opts.deployed ?? true;
  const service = createSyncService(ctx.db, {
    config: () => (deployed ? { version: 1, config } : undefined),
    at: () => config,
    versions: createVersionCache(() => config),
    clock: { now: () => '2026-05-01T08:00:00.000Z' },
    geo: createGeo(),
  });
  const bell = createDoorbell({ head: () => service.head(), pollMs: 0 });
  const toolBell = createToolBell();
  const logs = logSpy();
  const handlers = createSyncHandlers({
    log: logs.log,
    project: (key) => (key === 'demo' ? { id: 'p1', key } : undefined),
    rolesFor: (id) => (id === 'member' ? (['verwaltung'] as Key[]) : []),
    service: () => service,
    doorbell: () => bell,
    toolBell,
    ...(opts.heartbeatMs === undefined ? {} : { heartbeatMs: opts.heartbeatMs }),
  });
  return {
    ctx: { ...ctx, service },
    handlers,
    bell,
    toolBell,
    store: withDoorbell(ctx.store, bell),
    anna: { kind: 'participant', id: 'anna', projectId: 'p1', roles: ['kontrolle'] as Key[] },
    annaActor,
    logs,
  };
}
