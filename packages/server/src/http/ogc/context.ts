/** What every OGC route needs once the caller is known: the deployed config, the collection and the row filter. */
import type { Clock, CompiledConfig, Geo, Ids } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { Store } from '../../store';
import type { DeployedConfig, Predicate, SyncService } from '../../sync';
import type { HttpLimits, ProjectAccessDeps, ProjectCaller } from '../shared/contract';
import type { OgcSeams } from './seams';

export interface OgcDeps extends ProjectAccessDeps {
  /** The project database, for reads. Writes go through `store`. */
  db(projectKey: string): Db;
  /** `projectStoresFor(runtime)(key)`: the only store of a project (WP-137). */
  store(projectKey: string): Store;
  /** The project's sync service: `visible` is the one row filter (WP-106, R1). */
  sync(projectKey: string): SyncService;
  deployed(projectKey: string): DeployedConfig | undefined;
  readonly clock: Clock;
  readonly ids: Ids;
  readonly geo?: Geo;
  readonly seams?: Partial<OgcSeams>;
  readonly limits?: Partial<HttpLimits>;
  /** Candidates a residual filter may examine per request (default `RESIDUAL_SCAN_CAP`, 5000). */
  readonly residualScanCap?: number;
}

export interface Ctx {
  readonly deps: OgcDeps;
  readonly seams: OgcSeams;
  readonly geo: Geo;
  readonly caller: ProjectCaller;
  readonly config: CompiledConfig;
  readonly version: number;
  /** URL of the landing page, no trailing slash. */
  readonly base: string;
  /** The collection (feature type key) of the route; empty above the collection level. */
  readonly type: string;
  /** The languages the caller asked for (Accept-Language, best first); labels are resolved with `localize`. */
  readonly locales: readonly string[];
  /** The row filter of the caller over `features f`. */
  readonly visible: Predicate;
}
