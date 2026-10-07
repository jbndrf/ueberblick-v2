import { json, type RequestHandler } from '@sveltejs/kit';
import { addRoleToDraft } from '../draft-roles.server';
import { authorizeAdmin } from '../../../../../../../lib/server/authz';
import { LOCALE_COOKIE, resolveLocale } from '../../../../shell/locale';

/**
 * v3 `createRole` action (`participants/+page.server.ts:457-485`): a role typed in a participant's Rollen cell. In v4 a
 * role is part of the project file, so it is added to the draft (Q13), not written at once. The answer is the new role.
 */
export const POST: RequestHandler = async ({ request, params, locals, cookies }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  const name = typeof body === 'object' && body !== null ? (body as { name?: unknown }).name : undefined;
  if (typeof name !== 'string') return json({ error: 'Expected { name: text }.' }, { status: 400 });
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  const r = addRoleToDraft(auth.projectKey, auth.principal.id, name, locale);
  return r.ok
    ? json({ role: r.role }, { status: 201 })
    : json(
        { error: r.code, ...(r.detail ? { detail: r.detail } : {}) },
        { status: r.code === 'conflict' ? 409 : 400 },
      );
};
