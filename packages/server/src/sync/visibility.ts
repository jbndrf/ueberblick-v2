/** What one actor may see under one config version: the row predicate, readable properties, the fingerprint. */
import {
  scopeFingerprint,
  type Actor,
  type CompiledConfig,
  type Instant,
  type Json,
  type Key,
  type Perms,
} from '@ueberblick/core';
import type { VersionedConfig } from '../store/run/config-for';

/** A parameterised SQL boolean over `features` rows. */
export interface Predicate {
  readonly sql: string;
  readonly params: readonly Json[];
}

export interface Scope {
  readonly actor: Actor;
  readonly version: number;
  readonly config: CompiledConfig;
  readonly perms: Perms;
  readonly fingerprint: string;
  /** Rows of `features` (as `alias`) the actor may see. `now` is bound as a parameter. */
  visibleSql(alias: string, now: Instant): Predicate;
  /** Readable properties of a type; empty for a type the config does not know. */
  readable(type: string): ReadonlySet<string>;
  /** True when `relation` is a property of `type` the actor may not read (its edges would reveal the value). */
  hidesRelation(type: string, relation: string): boolean;
}

const EPOCH = '1970-01-01T00:00:00.000Z' as Instant;
const CACHE_LIMIT = 512;

/** One scope per (version, actor, roles) over a resolved version (its permissions compiled once by the resolver). Bounded. */
export function createResolvedScopes(): (actor: Actor, resolved: VersionedConfig) => Scope {
  const scopes = new Map<string, Scope>();
  return (actor, resolved) => {
    const key = `${resolved.version}\u0000${actor.id}\u0000${actor.kind}\u0000${[...actor.roles].sort().join(',')}`;
    const hit = scopes.get(key);
    if (hit !== undefined && hit.perms === resolved.perms) return hit;
    if (scopes.size >= CACHE_LIMIT) scopes.clear();
    const scope = buildScope(actor, resolved.version, resolved.config, resolved.perms);
    scopes.set(key, scope);
    return scope;
  };
}

function buildScope(actor: Actor, version: number, config: CompiledConfig, perms: Perms): Scope {
  const subjects = perms.subjects(actor);
  const types = Object.keys(config.file.types ?? {}).sort() as Key[];
  const readable = new Map<string, ReadonlySet<string>>();
  for (const t of types) readable.set(t, perms.forType(t)?.readable(subjects) ?? new Set());

  const visibleSql = (alias: string, now: Instant): Predicate => {
    const parts: string[] = [];
    const params: Json[] = [];
    for (const t of types) {
      const see = perms.forType(t)?.seeSql(subjects, actor, alias, now);
      if (see === undefined || see.kind === 'none') continue;
      if (see.kind === 'all') {
        parts.push(`${alias}.type = ?`);
        params.push(t);
      } else {
        parts.push(`(${alias}.type = ? AND (${see.sql}))`);
        params.push(t, ...see.params);
      }
    }
    return parts.length === 0 ? { sql: '0', params: [] } : { sql: `(${parts.join(' OR ')})`, params };
  };

  const inputs = types.map((t) => {
    const see = perms.forType(t)?.seeSql(subjects, actor, 'f', EPOCH);
    const rows =
      see === undefined ? 'none' : see.kind === 'where' ? JSON.stringify([see.sql, see.params]) : see.kind;
    return `${t}|${rows}|${[...(readable.get(t) ?? [])].sort().join(',')}`;
  });

  return {
    actor,
    version,
    config,
    perms,
    fingerprint: scopeFingerprint(inputs),
    visibleSql,
    readable: (type) => readable.get(type) ?? new Set(),
    hidesRelation: (type, relation) => {
      const def = config.file.types?.[type]?.properties;
      return def !== undefined && relation in def && !(readable.get(type)?.has(relation) ?? false);
    },
  };
}
