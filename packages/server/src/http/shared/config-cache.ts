import type { CompiledConfig } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { deployedVersion, loadConfig } from '../../deploy';
import { createVersionCache, type VersionCache } from '../../store/run/config-for';
import type { DeployedConfig } from '../../sync';

/** The compiled configs of one project database. */
export interface ConfigCache {
  /** A stored version, compiled. Versions are immutable rows, so a hit never goes stale; `undefined` when gone. */
  version(version: number): CompiledConfig | undefined;
  /** The deployed version: one indexed read to learn which, then the cached config. */
  deployed(): DeployedConfig | undefined;
}

const caches = new WeakMap<Db, ConfigCache>();

/**
 * The one cache of a database (memoised on the `Db`), so the run store, sync and timers of a project never
 * hydrate the same version twice: a run must not pay for `hydrate` (docs/12 "Run endpoint").
 */
export function configCacheFor(db: Db): ConfigCache {
  let cache = caches.get(db);
  if (cache === undefined) {
    const held = new Map<number, CompiledConfig>();
    const version = (n: number): CompiledConfig | undefined => {
      let config = held.get(n);
      if (config === undefined) {
        config = loadConfig(db, n);
        if (config !== undefined) held.set(n, config);
      }
      return config;
    };
    cache = {
      version,
      deployed() {
        const n = deployedVersion(db)?.version;
        const config = n === undefined ? undefined : version(n);
        return n === undefined || config === undefined ? undefined : { version: n, config };
      },
    };
    caches.set(db, cache);
  }
  return cache;
}

const versionCaches = new WeakMap<Db, VersionCache>();

/**
 * The one `VersionCache` of a database (memoised on the `Db`, A-029, WP-317): a version's permissions are compiled once
 * and shared by the run store, sync and blob access of the project (and timers and derive, WP-318), never once per reader.
 * It sits on `configCacheFor`, so a version is also hydrated once. A tool that injects its own configs (the import, which
 * has no stored compiled form) passes `load`: it gets a cache of its own over that loader, never memoised.
 */
export function versionCacheFor(
  db: Db,
  load?: (version: number) => CompiledConfig | undefined,
): VersionCache {
  if (load !== undefined) return createVersionCache(load);
  let cache = versionCaches.get(db);
  if (cache === undefined) {
    const configs = configCacheFor(db);
    cache = createVersionCache((version) => configs.version(version));
    versionCaches.set(db, cache);
  }
  return cache;
}
