/**
 * Server side of the pull protocol (docs/07, WP-106). CONTRACT: changes need the lead.
 *
 * `createSyncService(db, deps)` answers one `SyncRequest` with one `SyncPage` (object form; `http/sync` encodes and
 * compresses it). Everything is a pull: nothing is written per participant, so a run costs the same however many
 * participants there are (docs/12 "Run endpoint").
 *
 * - **Scope.** The rows a participant may see are `perms.forType(t).seeSql(...)` ORed over the types (one SQL
 *   predicate, `visibleSql`). Properties are cut to `readable(subjects)`, in feature rows and in observations. The
 *   scope fingerprint hashes what the compiled permissions say for this actor (row filters at a fixed instant and
 *   readable properties), so it changes when a role gains or loses access and not on an unrelated deploy.
 * - **Snapshot** (`since = 0`): live features in `updated_seq` order, `limit` per page, `after` = the last cursor,
 *   `pin` = the head the snapshot began at (a filter `updated_seq <= pin`). Each page carries the last 10
 *   observations per (feature, property) and the edges of its features whose other end is visible too.
 * - **Delta** (`since > 0`): a window of whole features: up to `limit` features with `updated_seq > since`, in order;
 *   `cursor` is the last one (or the head when the window is complete). A visible one is a row (an archived or deleted one is a tombstone, not a row; it had
 *   `lifecycle: 'deleted'`) with its last 10 observations per property and all its visible edges. One that is not visible
 *   now was visible at `since` when the state as of `since` passes `canSee`: then, and only then, the page carries a
 *   `feature` tombstone. Edge and redaction tombstones pass when the participant sees the feature(s) they name.
 * - **Live set (A-029 §4, protocol 3).** The versions served are `{deployed} ∪ distinct pinned_version`
 *   (`sync/live.ts`). A feature is visible under the `visible_when` and permissions of its own version,
 *   `coalesce(pinned_version, deployed)`; its properties and observations are cut by that version's readable set.
 *   Each row carries `version`, the header `versions { deployed, live }`, and the fingerprint covers the live set. With no pin
 *   the live set is `{deployed}` and the predicate, fingerprint and rows are the single-version ones.
 * - **Stale scope.** A request whose `scope` differs from the current fingerprint gets an empty page carrying the new
 *   one; the device re-snapshots (docs/07).
 * - Reserved properties (`$type`, `$lifecycle`) are never sent as observations; the row says what they mean.
 * - Seam (H4): an ephemeral view filter ANDs onto `visibleSql` in `sync/visibility.ts`. Not built.
 */
import type { ConfigResolver, VersionCache } from '../store/run/config-for';
import type { Predicate } from './visibility';
import type { Actor, Clock, CompiledConfig, Geo, Seq, SyncPage, SyncRequest } from '@ueberblick/core';

/** The most feature rows a page carries; also the default when the request names no `limit`. */
export const SYNC_PAGE_ROWS = 1000;

/** The deployed config version, compiled. */
export interface DeployedConfig {
  readonly version: number;
  readonly config: CompiledConfig;
}

export interface SyncServiceDeps {
  /** The deployed config version, or undefined before the first deploy. Called once per request; cache it. */
  readonly config: () => DeployedConfig | undefined;
  /** The compiled config of any stored version (`loadConfig(db, version)`, cached); `undefined` when it is gone. */
  readonly at: (version: number) => CompiledConfig | undefined;
  /** The project's shared version cache (`versionCacheFor(db)`). Required: sync never builds a cache of its own. */
  readonly versions: VersionCache;
  readonly clock: Clock;
  readonly geo: Geo;
}

export interface SyncService {
  /** One page for `actor`. Throws `SyncUnavailable` when no config is deployed. Synchronous and read-only. */
  page(actor: Actor, request: SyncRequest): SyncPage;
  /**
   * The row filter of `actor` over `features` rows named `alias`: what `page` clips by, for every other read path
   * (bbox queries, OGC API) so the permission predicate is never encoded twice (R1). H4: a view filter ANDs onto it.
   */
  visible(actor: Actor, alias: string): Predicate;
  /**
   * The one version resolver of this project's readers (A-029): `at(version)`, `versionOf(feature, deployed)` and
   * `configFor(deployed)` for the planner. Sync, the OGC write check and the other readers of a feature's version share it.
   */
  readonly versions: ConfigResolver;
  /** The server head: the highest seq of observations and tombstones. */
  head(): Seq;
}

/** No config version is deployed yet, so no scope exists. */
export class SyncUnavailable extends Error {
  constructor() {
    super('no config version is deployed');
    this.name = 'SyncUnavailable';
  }
}
