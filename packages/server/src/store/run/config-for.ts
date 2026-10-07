/**
 * The server's `ConfigFor` (A-029 §2, WP-315): which compiled config and permissions a feature is planned under.
 * A feature's version is `coalesce(pinned_version, deployed)`; a create (`NEW_FEATURE`) takes the deployed one.
 * Versions are immutable rows, so a cached entry never goes stale. The cache is a small LRU of the live versions
 * (default 8): a hit is a Map lookup, a miss reads one row and compiles it once (R14: never a compile per run).
 * It is also the seam sync per version (WP-316) and timers (WP-318) resolve versions through.
 */
import {
  compilePerms,
  NEW_FEATURE,
  type CompiledConfig,
  type ConfigFor,
  type FeatureId,
  type ResolvedConfig,
} from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { ConfigVersionGone } from './contract';

/** Versions the cache holds when the server config names none. */
export const DEFAULT_CONFIG_CACHE_SIZE = 8;

/** A version's config and permissions, with the version they belong to. */
export type VersionedConfig = ResolvedConfig & { readonly version: number };

/**
 * What the background paths (timers, derive) need of the project's versions: the config of a stored version and the
 * deployed one. Backed by the one cache of the project database (WP-317), never a second one (R1).
 */
export interface VersionResolver {
  /** The compiled config of a stored version; `undefined` when it is gone. */
  configFor(version: number): CompiledConfig | undefined;
  /** The deployed version and its config; `undefined` before the first deploy. */
  deployed(): { readonly version: number; readonly config: CompiledConfig } | undefined;
}

export interface VersionCache {
  /** The config and permissions of a stored version (compiled once while it stays in the cache); `undefined` when the version is gone. */
  get(version: number): VersionedConfig | undefined;
  /** Versions currently held, least recently used first (tests, diagnostics). */
  held(): readonly number[];
}

export function createVersionCache(
  load: (version: number) => CompiledConfig | undefined,
  capacity: number = DEFAULT_CONFIG_CACHE_SIZE,
): VersionCache {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error('the config cache holds at least one version');
  const entries = new Map<number, VersionedConfig>();
  return {
    get(version) {
      const hit = entries.get(version);
      if (hit !== undefined) {
        entries.delete(version); // most recently used goes last
        entries.set(version, hit);
        return hit;
      }
      const config = load(version);
      if (config === undefined) return undefined;
      const entry: VersionedConfig = { config, perms: compilePerms(config), version };
      entries.set(version, entry);
      if (entries.size > capacity) entries.delete(entries.keys().next().value as number);
      return entry;
    },
    held: () => [...entries.keys()],
  };
}

export interface ConfigResolver {
  /** The `ConfigFor` of one plan call, with `deployed` as the version of floating features and creates. */
  configFor(deployed: number): ConfigFor;
  /** The version a feature is planned under: its pin, else `deployed`. One primary-key read. */
  versionOf(id: FeatureId, deployed: number): number;
  /** The config of a version, from the cache. Throws `ConfigVersionGone` when it is not stored. */
  at(version: number): VersionedConfig;
}

export function createConfigResolver(db: Db, cache: VersionCache): ConfigResolver {
  const pinned = db.prepare<{ pinned_version: number | null }>(
    'SELECT pinned_version FROM features WHERE id = ?',
  );
  const at = (version: number): VersionedConfig => {
    const hit = cache.get(version);
    if (hit === undefined) throw new ConfigVersionGone(version);
    return hit;
  };
  const versionOf = (id: FeatureId, deployed: number): number => pinned.get(id)?.pinned_version ?? deployed;
  return {
    at,
    versionOf,
    configFor: (deployed) => (feature) =>
      at(feature === NEW_FEATURE ? deployed : versionOf(feature, deployed)),
  };
}
