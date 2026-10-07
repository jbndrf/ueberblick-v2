import type { DraftStatus, Principal } from '@ueberblick/server';
import { json, type Call } from '../../../../../../lib/server/handlers/http';

/** What the handler needs from the app; the route wires the real ones (tests pass fakes). */
export interface DraftStatusDeps {
  authorize(principal: Principal | null, project: string): { readonly projectKey: string } | Response;
  status(project: string): DraftStatus;
}

/**
 * `GET /api/admin/p/<project>/draft/status` (E-13): `{ dirty, neverPublished, problems, revision, type }`.
 * The admin shell reads it to show the unpublished-changes bar and the sidebar badge.
 */
export function createDraftStatusHandler(deps: DraftStatusDeps) {
  return (call: Pick<Call, 'params' | 'locals'>): Response => {
    const auth = deps.authorize(call.locals.admin, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    return json(deps.status(auth.projectKey), 200, { 'cache-control': 'no-store' });
  };
}
