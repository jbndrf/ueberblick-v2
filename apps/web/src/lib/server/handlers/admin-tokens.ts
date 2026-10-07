/**
 * The QGIS / GIS tokens of the Projekteinstellungen section "API-Tokens" (WP-388, A-037, v3 `createApiToken` and
 * `revokeApiToken` actions of `settings/+page.server.ts`):
 *
 *   GET    /api/admin/p/<project>/tokens         { tokens }  (never the secret)
 *   POST   /api/admin/p/<project>/tokens         { participant | admin: true, label, expiresAt? } -> 201 { token, info }
 *          (the secret, once). `admin: true` (WP-1070) binds the token to the calling admin account.
 *   DELETE /api/admin/p/<project>/tokens/<id>    204 | 404
 *
 * Admin of the project only (401/403/404 from `authorizeAdmin`); changes must come from the admin app (same origin).
 */
import { isAuthError } from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import { isRecord, json, readJson, type Call } from './http';

const MESSAGES: Record<string, string> = {
  token_invalid: 'The label must have 1 to 100 characters.',
  participant_disabled: 'The participant or admin account does not exist or is disabled.',
};

function scoped(call: Call, change: boolean) {
  const auth = authorizeAdmin(call.locals.admin, call.params['project'] ?? '');
  if (auth instanceof Response) return auth;
  if (change && call.request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, 403);
  const project = runtime().project(auth.projectKey);
  return project
    ? { ...project, adminId: auth.principal.id }
    : json({ error: `Unknown project ${auth.projectKey}.` }, 404);
}

export const adminTokensHandlers = {
  GET(call: Call): Response {
    const project = scoped(call, false);
    if (project instanceof Response) return project;
    return json({ tokens: runtime().auth.apiTokens.list(project.id) });
  },

  async POST(call: Call): Promise<Response> {
    const project = scoped(call, true);
    if (project instanceof Response) return project;
    const body = await readJson(call.request);
    if ('response' in body) return body.response;
    const { participant, admin, label, expiresAt } = isRecord(body.value) ? body.value : {};
    if (
      (admin === true) === (typeof participant === 'string') ||
      typeof label !== 'string' ||
      (expiresAt !== undefined && typeof expiresAt !== 'string')
    )
      return json({ error: 'Expected { participant | admin: true, label, expiresAt? }.' }, 400);
    if (expiresAt !== undefined && !(new Date(expiresAt).getTime() > Date.parse(runtime().clock.now())))
      return json({ error: 'The expiry must be a date in the future.' }, 400);
    const opts = { label, ...(expiresAt === undefined ? {} : { expiresAt }) };
    const tokens = runtime().auth.apiTokens;
    const issued =
      admin === true
        ? tokens.issueAdmin(project.id, project.adminId, opts)
        : tokens.issue(project.id, participant as string, opts);
    if (isAuthError(issued))
      return json({ error: issued.code, message: MESSAGES[issued.code] ?? issued.code }, 400);
    return json(issued, 201);
  },

  DELETE(call: Call): Response {
    const project = scoped(call, true);
    if (project instanceof Response) return project;
    return runtime().auth.apiTokens.revoke(project.id, call.params['id'] ?? '')
      ? new Response(null, { status: 204 })
      : json({ error: 'Unknown token.' }, 404);
  },
};
