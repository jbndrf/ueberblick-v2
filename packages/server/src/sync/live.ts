/**
 * What one actor may see across the live set (A-029 §4, WP-316): one `Scope` per live config version and the union of
 * their row predicates, each guarded by "the row follows this version". A row is read under its own version only:
 * `coalesce(pinned_version, deployed)`. The cost is O(live versions), a handful, never O(features) (R14).
 */
import { scopeFingerprint, type Actor, type CompiledConfig, type Instant, type Json } from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { ConfigResolver } from '../store/run/config-for';
import { withActivityNames } from './runs';
import { createResolvedScopes, type Predicate, type Scope } from './visibility';

export interface LiveScope {
  readonly actor: Actor;
  readonly deployed: number;
  /** Ascending, each version once, `deployed` included. */
  readonly live: readonly number[];
  /** The deployed config: what actor-wide settings (activity names) read. */
  readonly config: CompiledConfig;
  /** One fingerprint over the live set: with a single live version it is that version's (so zero pins change nothing). */
  readonly fingerprint: string;
  /** The scope of one version (any stored version, not only a live one). */
  at(version: number): Scope;
  /** The version a row follows: its pin, else the deployed version. */
  versionOf(pinned: number | null | undefined): number;
  /** Rows of `features` (as `alias`) the actor may see: the union over the live set. */
  visibleSql(alias: string, now: Instant): Predicate;
}

/** The pinned versions, ascending, each found with one index probe (a loose scan of the partial index `features_pinned`). */
export const LIVE_PINS = `WITH RECURSIVE v(x) AS (
    SELECT min(pinned_version) FROM features WHERE pinned_version IS NOT NULL
    UNION ALL
    SELECT (SELECT min(pinned_version) FROM features WHERE pinned_version > x) FROM v WHERE x IS NOT NULL)
  SELECT x FROM v WHERE x IS NOT NULL`;

export type LiveScopes = (actor: Actor, deployed: number) => LiveScope;

export function createLiveScopes(db: Db, versions: ConfigResolver): LiveScopes {
  const scopes = createResolvedScopes();
  const pins = db.prepare<{ x: number }>(LIVE_PINS);
  const scopeOf = (actor: Actor, version: number): Scope =>
    withActivityNames(scopes(actor, versions.at(version)));

  return (actor, deployed) => {
    const live = [...new Set([deployed, ...pins.all().map((r) => r.x)])].sort((a, b) => a - b);
    const byVersion = new Map(live.map((v) => [v, scopeOf(actor, v)] as const));
    const at = (v: number): Scope => byVersion.get(v) ?? scopeOf(actor, v);
    const home = at(deployed);
    const single = live.length === 1;
    return {
      actor,
      deployed,
      live,
      config: home.config,
      fingerprint: single ? home.fingerprint : scopeFingerprint(live.map((v) => `${v}|${at(v).fingerprint}`)),
      at,
      versionOf: (pinned) => pinned ?? deployed,
      visibleSql(alias, now) {
        if (single) return home.visibleSql(alias, now); // every row follows the deployed version
        const parts: string[] = [];
        const params: Json[] = [];
        for (const v of live) {
          const p = at(v).visibleSql(alias, now);
          parts.push(`(coalesce(${alias}.pinned_version, ?) = ? AND ${p.sql})`);
          params.push(deployed, v, ...p.params);
        }
        return { sql: `(${parts.join(' OR ')})`, params };
      },
    };
  };
}
