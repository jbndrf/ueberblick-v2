import { createGeo, type Clock } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { Store, TransactionHook } from '../../store';
import {
  createDoorbell,
  createSyncService,
  type DeployedConfig,
  type Doorbell,
  type SyncService,
} from '../../sync';
import type { Logger } from '../../log';
import { createMoveExecutor, type MoveExecutor, type PinDeps } from '../../deploy';
import { createTimers, type Timers } from '../../timers';
import { configCacheFor, versionCacheFor } from './config-cache';
import { createServerIds } from './ids';
import { createToolBell, type ToolBell } from '../../modules/chat/tool-bell';

export interface ProjectServicesDeps {
  readonly clock: Clock;
  /** The process logger (`timer.dropped`). Required: a service without one would be silent. */
  readonly log: Logger;
  projectDb(key: string): Db;
  /** The project's store: `projectStoresFor(runtime)(key)`. Fired timers are submitted through it (R3). */
  store(projectKey: string): Store;
  /** Head check of a doorbell that has listeners, for writers in other processes. Default 2000 ms; 0 turns it off. */
  readonly doorbellPollMs?: number;
}

/**
 * The per-project services that share a database and the compiled config (WP-137): sync, the doorbell and the
 * timers. A runtime plugs `hooks` and `doorbell` into `projectStoresFor`, so one store per project carries both.
 */
export interface ProjectServices {
  /** For `ProjectStoresDeps.hooks`: the timers hook of the project. */
  hooks(project: { readonly key: string; readonly db: Db }): readonly TransactionHook[];
  /** For `ProjectStoresDeps.doorbell`; the same object for every caller in this process. */
  doorbell(projectKey: string): Doorbell;
  /** The tool bell (docs/07): rung when a tool stream moved, heard by the sync events handler. One per process. */
  readonly toolBell: ToolBell;
  sync(projectKey: string): SyncService;
  timers(projectKey: string): Timers;
  /** The deployed config, or undefined before the first deploy. */
  deployed(projectKey: string): DeployedConfig | undefined;
  /** The project's value-move executor (WP-307): runs the `deploy_moves` rows of deploys with `{ to }` mappings. */
  moves(projectKey: string): MoveExecutor;
  /** Starts the executor on its open rows (server start; a deploy does it through `afterDeploy`). */
  resumeMoves(projectKey: string): void;
  /** What a deploy's `keep` needs (WP-317): the project's store and run ids, to write the `$pin` system runs in the deploy transaction. */
  pins(projectKey: string): PinDeps;
  /** Lets go of the cached sync, timers and executor of a project whose database was closed and re-created (a preview reset, WP-373). */
  forget(projectKey: string): void;
  /** Call after a deploy: reschedules elapsed rules for the features that exist and adds the missing cron rows. */
  afterDeploy(projectKey: string): void;
}

export function createProjectServices(deps: ProjectServicesDeps): ProjectServices {
  const geo = createGeo();
  const ids = createServerIds(deps.clock);
  const toolBell = createToolBell();
  const syncs = new Map<string, SyncService>();
  const bells = new Map<string, Doorbell>();
  /** Projects whose store is writing inside a deploy transaction: its accepted runs must not ring (see `pins`). */
  const muted = new Set<string>();
  const timers = new Map<string, Timers>();
  const configs = (key: string) => configCacheFor(deps.projectDb(key));

  const sync = (key: string): SyncService => {
    let s = syncs.get(key);
    if (s === undefined) {
      const cache = configs(key);
      s = createSyncService(deps.projectDb(key), {
        clock: deps.clock,
        geo,
        config: () => cache.deployed(),
        at: (version) => cache.version(version),
        versions: versionCacheFor(deps.projectDb(key)),
      });
      syncs.set(key, s);
    }
    return s;
  };

  const timersOf = (key: string): Timers => {
    let t = timers.get(key);
    if (t === undefined) {
      const cache = configs(key);
      t = createTimers(deps.projectDb(key), {
        clock: deps.clock,
        ids,
        geo,
        versions: { configFor: (v) => cache.version(v), deployed: () => cache.deployed() },
        submit: (run) => deps.store(key).submit(run),
        log: deps.log,
      });
      timers.set(key, t);
    }
    return t;
  };

  const executors = new Map<string, MoveExecutor>();
  const movesOf = (key: string): MoveExecutor => {
    let m = executors.get(key);
    if (m === undefined) {
      m = createMoveExecutor(deps.projectDb(key), {
        store: { submit: (run) => deps.store(key).submit(run) },
        ids,
        pause: () => new Promise((resolve) => setImmediate(resolve)),
      });
      executors.set(key, m);
    }
    return m;
  };
  const startMoves = (key: string): void => {
    const m = movesOf(key);
    if (m.pending())
      m.start((e) =>
        deps.log.log('moves.failed', { projectKey: key, code: e instanceof Error ? e.name : 'threw' }),
      );
  };

  return {
    hooks: ({ key }) => [timersOf(key).hook],
    doorbell(key) {
      let b = bells.get(key);
      if (b === undefined) {
        const poll = deps.doorbellPollMs;
        const bell = createDoorbell({
          head: () => sync(key).head(),
          ...(poll === undefined ? {} : { pollMs: poll }),
        });
        // A deploy's pin runs commit with the deploy; `afterDeploy` rings once, so a rolled-back deploy leaves `last` alone.
        b = {
          ring: () => (muted.has(key) ? undefined : bell.ring()),
          subscribe: (l) => bell.subscribe(l),
          head: () => bell.head(),
          get listeners() {
            return bell.listeners;
          },
        };
        bells.set(key, b);
      }
      return b;
    },
    toolBell,
    sync,
    timers: timersOf,
    deployed: (key) => configs(key).deployed(),
    forget(key) {
      syncs.delete(key);
      timers.delete(key);
      executors.delete(key);
    },
    afterDeploy(key) {
      // The deploy committed (this runs after it): tell the devices once, a `move` deploy included (the config changed).
      bells.get(key)?.ring();
      const t = timersOf(key);
      t.rebuild();
      t.syncSchedules();
      startMoves(key);
    },
    moves: movesOf,
    pins: (key) => {
      const store = deps.store(key);
      const quiet = <T>(fn: () => T): T => {
        muted.add(key);
        try {
          return fn();
        } finally {
          muted.delete(key);
        }
      };
      return {
        store: { submitBatch: (runs) => quiet(() => store.submitBatch(runs)) },
        ids,
      };
    },
    resumeMoves: startMoves,
  };
}
