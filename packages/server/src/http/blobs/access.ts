/**
 * Who may download a blob (WP-604): an admin of the project, the actor of a run that named it, or whoever can read it.
 * "Can read it" is judged under the permissions of the feature's own version, `coalesce(pinned_version, deployed)`
 * (A-029, WP-317): the live scopes (`sync/live.ts`) over the same resolver sync uses, so a pinned feature's file follows
 * its pinned version's `see` and readable properties, and a floating one the deployed version's.
 */
import { servedSql, type Actor, type Clock } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { ConfigResolver } from '../../store/run/config-for';
import { createLiveScopes } from '../../sync/live';

export interface BlobAccessDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** The deployed version, or undefined before the first deploy. */
  deployed(): number | undefined;
  /** The project's version resolver (the one of its sync service). */
  readonly versions: ConfigResolver;
  /** Blobs the deployed config itself names (`branding.icon`, A-036): every participant of the project may read them. */
  configBlobs?(): readonly string[];
}

export interface BlobAccess {
  /** `actor` has already passed the project check (`authorizeProject`): an admin here has a role in the project. */
  allowed(actor: Actor, sha256: string): boolean;
}

interface Row {
  type: string;
  property: string;
  pinned_version: number | null;
}

export function createBlobAccess(deps: BlobAccessDeps): BlobAccess {
  const liveScopes = createLiveScopes(deps.db, deps.versions);
  const authored = deps.db.prepare(
    `SELECT 1 AS x FROM blob_refs b JOIN runs r ON r.id = b.run_id
     WHERE b.sha256 = ? AND r.actor = ? AND r.actor_kind = ? LIMIT 1`,
  );
  const statements = new Map<string, ReturnType<typeof prepareBySha>>();
  function prepareBySha(visible: string) {
    // Only the CURRENT value counts: the feature's folded property must still name the sha.
    return deps.db.prepare<Row>(
      `SELECT DISTINCT f.type AS type, b.property AS property, f.pinned_version AS pinned_version
       FROM blob_refs b JOIN features f ON f.id = b.feature_id
       WHERE b.sha256 = ? AND ${servedSql('f.lifecycle')} AND ${visible}
         AND instr(json_extract(f.properties, '$."' || b.property || '"'), ?) > 0`,
    );
  }
  return {
    allowed(actor, sha256) {
      if (actor.kind === 'admin') return true;
      if (deps.configBlobs?.().includes(sha256) === true) return true;
      if (authored.get(sha256, actor.id, actor.kind) !== undefined) return true;
      const deployed = deps.deployed();
      if (deployed === undefined) return false;
      const scope = liveScopes(actor, deployed);
      const vis = scope.visibleSql('f', deps.clock.now());
      let stmt = statements.get(vis.sql);
      if (stmt === undefined) statements.set(vis.sql, (stmt = prepareBySha(vis.sql)));
      const rows = stmt.all(sha256, ...(vis.params as (string | number)[]), `"sha256":"${sha256}"`);
      return rows.some((r) => scope.at(scope.versionOf(r.pinned_version)).readable(r.type).has(r.property));
    },
  };
}
