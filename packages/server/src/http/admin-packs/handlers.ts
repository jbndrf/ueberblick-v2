/**
 * `/api/admin/p/<project>/packs` (A-032 item 5): what an admin sees of the offline packs of the deployed config, and the
 * retry of a failed one. Admin only (`authorizeAdmin`), project-scoped as the other admin endpoints.
 *
 *   GET  packs                 -> { packs: PackStatus[] }  (definition, estimate, state, progress, bytes, built_at)
 *   POST packs/<key>/rebuild   -> { queued: n }            (409 `conflict` unless a layer of the pack has failed)
 *
 * Create, edit and delete of a pack are draft edits (Doc ops), not routes here.
 */
import type { Principal } from '../../auth/contract';
import type { Db } from '../../db/driver';
import { requeueFailed } from '../../packs/store';
import type { DeployedConfig } from '../../sync';
import { errorResponse, jsonResponse } from '../shared/errors';
import { packStatuses } from './status';

export interface AdminPacksCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface AdminPacksDeps {
  /** The refusing response (401, 403, 404), or the authorised project key. */
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  db(projectKey: string): Db;
  deployed(projectKey: string): DeployedConfig | undefined;
  readonly clock: { now(): string };
  /** Wakes the build worker after a rebuild was queued (optional: the worker also polls). */
  kick?(projectKey: string): void;
}

export interface AdminPacksHandlers {
  list(call: AdminPacksCall): Response;
  rebuild(call: AdminPacksCall): Response;
}

export function createAdminPackHandlers(deps: AdminPacksDeps): AdminPacksHandlers {
  function resolve(call: AdminPacksCall): { projectKey: string; deployed: DeployedConfig } | Response {
    const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    const deployed = deps.deployed(auth.projectKey);
    if (deployed === undefined) return errorResponse('conflict', 'The project has no deployed config yet.');
    return { projectKey: auth.projectKey, deployed };
  }
  return {
    list(call) {
      const r = resolve(call);
      if (r instanceof Response) return r;
      const res = jsonResponse({ packs: packStatuses(deps.db(r.projectKey), r.deployed.config.file) });
      res.headers.set('cache-control', 'private, no-store');
      return res;
    },
    rebuild(call) {
      const r = resolve(call);
      if (r instanceof Response) return r;
      const key = call.params['key'] ?? '';
      const db = deps.db(r.projectKey);
      const pack = packStatuses(db, r.deployed.config.file).find((p) => p.key === key);
      if (pack === undefined) return errorResponse('not_found', `The project has no offline pack '${key}'.`);
      if (pack.state !== 'failed')
        return errorResponse('conflict', `The pack '${key}' has no failed build to retry.`);
      const queued = requeueFailed(db, pack.hash, deps.clock.now());
      deps.kick?.(r.projectKey);
      return jsonResponse({ queued });
    },
  };
}
