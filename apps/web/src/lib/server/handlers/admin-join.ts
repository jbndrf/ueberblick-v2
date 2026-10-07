/**
 * The Selbstbeitritt switch of the Rollen page (WP-367, v3 `toggleSelfJoinable` action of `roles/+page.server.ts`):
 * `PUT /admin/projects/<project>/roles/join` with `{ role, enabled }`. The link (slug, switch) lives in the control
 * database (`packages/server/src/join/links.ts`), not in the project file, so the change applies at once and is no
 * part of a draft (owner Q14). Switching on creates the link with a generated slug; switching off keeps the slug, so a
 * printed poster works again after switching on. Admin-only (401/403) and scoped to the project (404).
 */
import { setSelfJoin } from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import { isRecord, json, readJson, type Call } from './http';

export interface JoinSwitchOptions {
  /** Whether the project's draft (or deployed file) has this role. */
  knownRole(projectKey: string, role: string): boolean;
}

export async function joinSwitch(call: Call, options: JoinSwitchOptions): Promise<Response> {
  const auth = authorizeAdmin(call.locals.admin, call.params['projectId'] ?? '');
  if (auth instanceof Response) return auth;
  if (call.request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, 403);
  const body = await readJson(call.request);
  if ('response' in body) return body.response;
  const { role, enabled } = isRecord(body.value) ? body.value : {};
  if (typeof role !== 'string' || typeof enabled !== 'boolean')
    return json({ error: 'Expected { role, enabled: boolean }.' }, 400);
  if (!options.knownRole(auth.projectKey, role)) return json({ error: 'unknown_role', detail: role }, 400);
  const rt = runtime();
  const project = rt.project(auth.projectKey);
  if (!project) return json({ error: `Unknown project ${auth.projectKey}.` }, 404);
  const done = setSelfJoin({ control: rt.control, now: () => new Date(rt.clock.now()) }, project.id, role, {
    enabled,
  });
  if (!done.ok) return json({ error: done.code }, 400);
  return json({ role, enabled: done.selfJoin.enabled, slug: done.selfJoin.slug });
}
