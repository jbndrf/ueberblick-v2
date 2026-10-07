/**
 * Config versions on the device (docs/07-sync-and-offline.md, WP-514, WP-669). CONTRACT: changes need the lead.
 *
 * CONTRACT change approved by lead-b (WP-669): `ConfigStorePort.deleteConfigVersion`, `ConfigVersions.retain`,
 * `ConfigVersions.deployed` and `ConfigVersions.follow` (the device keeps the live versions, A-029 item 4).
 *
 * - A queued run records the `config_version` it was made against. The device keeps the compiled form of
 *   every version it needs (`CompiledConfigData`, A-005) and hydrates it with core's `hydrate` only:
 *   the compiler never runs on the device.
 * - `get` is synchronous (the run queue and the form renderer call it on hot paths); the versions are held
 *   in memory, loaded once at open.
 * - A stored version whose `format` this core cannot read (older after an app update, or newer after a
 *   rollback) is `'refetching'` until the server's recompiled copy arrives. The server recompiles on demand.
 *   Nothing is dropped and no run is touched meanwhile: runs stay queued and visible (docs/07).
 * - Store and network are ports, so an ephemeral-view client (H4) passes an in-memory store and its own fetcher.
 */
import type { CompiledConfig, CompiledConfigData } from '@ueberblick/core/hydrate';
import type { SyncVersions } from '@ueberblick/core/sync';
import type { StoredConfigVersion } from '../store';

/** The HTTP port: the server's compiled form of one config version, recompiled on demand. */
export interface ConfigFetcher {
  fetchCompiled(version: number): Promise<CompiledConfigData>;
}

/** The slice of the device store this module needs. */
export interface ConfigStorePort {
  putConfigVersion(version: number, data: CompiledConfigData): Promise<void>;
  readConfigVersions(): Promise<readonly StoredConfigVersion[]>;
  /** Idempotent: an unknown version is a no-op. */
  deleteConfigVersion(version: number): Promise<void>;
}

export interface ConfigVersionsDeps {
  readonly store: ConfigStorePort;
  readonly fetcher: ConfigFetcher;
}

/**
 * What a sync host tells the device about config versions (WP-669): each page header's `versions`, and a completed
 * pull (`synced`, after which versions neither live nor queued are dropped). The worker host forwards both over the
 * host protocol to the main thread, where `ConfigVersions` lives; the in-thread host calls it directly.
 */
export interface VersionsSink {
  follow(versions: SyncVersions): void;
  synced(versions: SyncVersions): Promise<void>;
}

export type ConfigVersionResult = CompiledConfig | 'refetching';

export interface ConfigVersions {
  /**
   * The runtime config of this version, or `'refetching'`. An unknown or unreadable version is wanted
   * from now on and fetched in the background (single flight per version).
   */
  get(version: number): ConfigVersionResult;
  /** The deployed version of the last sync header; `undefined` before the first one. A create resolves to it. */
  readonly deployed: number | undefined;
  /**
   * A sync page header arrived: `deployed` follows it and every live version is wanted (background fetch,
   * single flight; one already readable is not fetched again). Touches only the versions, never features.
   */
  follow(versions: { readonly deployed: number; readonly live: readonly number[] }): void;
  /**
   * Drops every stored and in-memory version that is neither live (the latest `follow`) nor named by a queued run
   * (`queued`: the `configVersion` of each). Call it only after a completed sync, never offline. It runs in one
   * critical section with `follow` and the fetch commits, and reads `queued` inside it, so a newer header's version
   * is never dropped, a version wanted again meanwhile keeps its row, and two retains never overlap. Before the
   * first `follow` it does nothing. CONTRACT change approved by lead-b (WP-669, review fix).
   */
  retain(queued: () => Promise<Iterable<number>>): Promise<void>;
  /** Versions wanted but not readable yet, ascending: the run queue shows the runs that wait on them. */
  awaiting(): readonly number[];
  /** Fetches every awaiting version and resolves when each attempt ended. A failed fetch stays awaiting. */
  refresh(): Promise<void>;
  /** Why the last fetch of a version failed (transport, or a copy this core still cannot read). */
  lastError(version: number): string | undefined;
  /** Called when a version became readable or a fetch failed. */
  subscribe(listener: () => void): () => void;
}
