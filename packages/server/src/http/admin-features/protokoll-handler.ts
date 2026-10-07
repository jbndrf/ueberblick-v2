/**
 * `GET /api/admin/p/<project>/features/<id>/runs/<run>` (WP-372, owner A3): the Protokoll of one past run, see
 * `protokoll.ts`. Admin only; the viewer is the calling admin (no field filter, `visibleProperties`).
 * Errors use the envelope of `http/shared`: 404 `not_found` for an unknown feature, a run of another feature, a refused
 * run (it wrote nothing) or a version that is gone.
 */
import type { Actor } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import type { Db } from '../../db/driver';
import type { VersionCache } from '../../store/run/config-for';
import { errorResponse } from '../shared/errors';
import { protokollOf } from './protokoll';
import type { ProtokollMiss } from './protokoll-registry';

export interface ProtokollCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface ProtokollDeps {
  /** The refusing response (401, 403, 404), or the authorised project key. */
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  db(projectKey: string): Db;
  /** The project's shared version cache (`versionCacheFor(db)`). */
  versions(projectKey: string): VersionCache;
}

const MESSAGES: Readonly<Record<ProtokollMiss, string>> = {
  run_not_found: 'The feature has no such run.',
  run_refused: 'The run was refused, so it has no Protokoll.',
  version_gone: 'The config version of the run is no longer stored.',
};

export function createProtokollHandler(deps: ProtokollDeps): (call: ProtokollCall) => Response {
  return (call) => {
    const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    const db = deps.db(auth.projectKey);
    const feature = call.params['feature'] ?? '';
    if (db.prepare('SELECT 1 FROM features WHERE id = ?').get(feature) === undefined)
      return errorResponse('not_found', `The project has no feature '${feature}'.`);
    const p = call.principal as Principal;
    const viewer: Actor = { id: p.id, kind: p.kind, roles: p.roles };
    const out = protokollOf(db, deps.versions(auth.projectKey), feature, call.params['run'] ?? '', viewer);
    if (typeof out === 'string') return errorResponse('not_found', MESSAGES[out]);
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    });
  };
}
