import {
  createGeo,
  formApi,
  PLAN_MAX_RULE_DEPTH,
  type Clock,
  type CompiledConfig,
  type Ids,
} from '@ueberblick/core';
import { createBlobSweeper, type BlobStore } from '../../blobs';
import type { Db } from '../../db/driver';
import type { Logger } from '../../log';
import { createStore, type Store, type TransactionHook } from '../../store';
import { withDoorbell, type DeployedConfig, type Doorbell } from '../../sync';
import { createTimers } from '../../timers';
import { configCacheFor, versionCacheFor } from './config-cache';
import { createServerIds } from './ids';

export interface ProjectStoresDeps {
  readonly clock: Clock;
  /** The process logger (`run.committed`, `run.refused`). Required: a store without one would be silent (R11). */
  readonly log: Logger;
  /** The project's database, opened on first use. */
  projectDb(key: string): Db;
  /**
   * The hooks of one project's store, after the fold and in order (timers, outbox). Called once per project, when its
   * store is created: hooks belong to a database (`createTimers(db, ...)`), so they are not shared across projects.
   */
  hooks?(project: { readonly key: string; readonly db: Db }): readonly TransactionHook[];
  /** The project's doorbell: when given, every accepted run of the store rings it once the transaction committed. */
  doorbell?(projectKey: string): Doorbell;
  /**
   * The project's blob bytes. Required: an erasure deletes the bytes it orphaned right after its commit, and the
   * store sweeps once when it is created, which finishes a delete a crash interrupted (WP-142.1, A-019). A runtime
   * without it would erase the database and silently keep personal bytes.
   */
  readonly blobs: {
    store(projectKey: string): BlobStore;
    /** A failed byte delete or sweep. It never fails the run: the next start's sweep retries. */
    onError(projectKey: string, error: unknown): void;
  };
}

/** The stores of a runtime; `forget` lets go of one whose database was closed and re-created (a preview reset, WP-373). */
export type ProjectStoreSource = ((projectKey: string) => Store) & { forget(projectKey: string): void };

const shared = new WeakMap<object, ProjectStoreSource>();

/**
 * The process-wide stores of a runtime (memoised on the runtime object): the ONLY way to get a project's `Store`.
 * The run endpoints, the timers loop and sync share one per project, with its hooks attached once and its doorbell
 * wired, so a run from any source is planned, hooked and announced the same way.
 */
export function projectStoresFor(rt: ProjectStoresDeps): ProjectStoreSource {
  let stores = shared.get(rt);
  if (stores === undefined) {
    stores = createProjectStores(rt);
    shared.set(rt, stores);
  }
  return stores;
}

/** What `composeProjectStore` needs. Everything a caller may vary is here; nothing else about a store varies. */
export interface ComposeStoreDeps {
  readonly clock: Clock;
  /** Where `run.committed` and `run.refused` go. A one-off tool passes a discard logger, never nothing (R11). */
  readonly log: Logger;
  /**
   * The hooks after the fold, in order. Omitted, the store builds the timers hook of this database itself, so a store
   * made by a tool schedules elapsed rules exactly as the runtime's does. The runtime passes its shared ones.
   */
  readonly hooks?: readonly TransactionHook[];
  /** An erasure's orphaned blob ids, right after its commit. */
  readonly onOrphanedBlobs: (ids: readonly string[]) => void;
  /** Run once when the store is created (the blob sweeper). Absent where there are no blob bytes. */
  readonly sweep?: () => void;
  /** Default: the configs stored in the database, cached. */
  readonly config?: (version: number) => CompiledConfig | undefined;
  /** The config the timers plan against. Default: the deployed one. A tool with no deployed version passes its own. */
  readonly current?: () => DeployedConfig | undefined;
  /** Default: the server's minter. A replay passes its own (it mints nothing). */
  readonly ids?: Ids;
}

/**
 * The ONLY place a server `Store` is made (R1): runtime, migration and backup replay all compose through it, so they
 * carry the same limits, config cache, form api and hooks (a grep test guards it). Does not attach a doorbell.
 */
export function composeProjectStore(db: Db, deps: ComposeStoreDeps): Store {
  const geo = createGeo();
  const configs = configCacheFor(db);
  const ids = deps.ids ?? createServerIds(deps.clock);
  const hooks = deps.hooks ?? [
    createTimers(db, {
      clock: deps.clock,
      ids,
      geo,
      versions: {
        configFor: (v) => (deps.config ?? configs.version)(v),
        deployed: deps.current ?? (() => configs.deployed()),
      },
      submit: (run) => store.submit(run),
      log: deps.log,
    }).hook,
  ];
  const store: Store = createStore(db, {
    clock: deps.clock,
    log: deps.log,
    ids,
    geo,
    limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
    config: deps.config ?? ((version) => configs.version(version)),
    // The shared cache is built on the database's own configs; a caller that brings its own `config` gets one over it.
    versions: versionCacheFor(db, deps.config),
    form: formApi,
    hooks,
    onOrphanedBlobs: (blobIds) => deps.onOrphanedBlobs(blobIds),
  });
  deps.sweep?.();
  return store;
}

/** One `Store` per project database, created on first use and kept. Prefer `projectStoresFor`. */
export function createProjectStores(deps: ProjectStoresDeps): ProjectStoreSource {
  const stores = new Map<string, Store>();
  const get = (key: string): Store => {
    let store = stores.get(key);
    if (store === undefined) {
      const db = deps.projectDb(key);
      const hooks = deps.hooks?.({ key, db });
      const bytes = deps.blobs.store(key);
      const failed = (e: unknown): void => deps.blobs.onError(key, e);
      const plain = composeProjectStore(db, {
        clock: deps.clock,
        log: deps.log,
        ...(hooks ? { hooks } : {}),
        onOrphanedBlobs: (ids) => void bytes.delete(ids).catch(failed),
        sweep: () => void createBlobSweeper({ db, store: bytes }).sweep().catch(failed),
      });
      store = deps.doorbell ? withDoorbell(plain, deps.doorbell(key)) : plain;
      stores.set(key, store);
    }
    return store;
  };
  return Object.assign(get, { forget: (key: string): void => void stores.delete(key) });
}
