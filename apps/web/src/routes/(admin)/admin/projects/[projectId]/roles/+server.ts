import { json, type RequestHandler } from '@sveltejs/kit';
import type { RoleErrorCode } from './roles-doc';
import { runRoleCall } from './roles.server';
import type { RoleCall } from '../../../../../../lib/admin/roles/types';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { adminMessage, type AdminKey } from '../../../shell/messages';
import { LOCALE_COOKIE, resolveLocale } from '../../../shell/locale';

const ACTIONS = ['create', 'update', 'quota', 'uses', 'delete'] as const;
const REFUSAL: Record<RoleErrorCode, AdminKey> = {
  name_short: 'rol_err_name_short',
  quota_invalid: 'rol_quota_invalid',
  unknown_role: 'rol_err_unknown_role',
  refused: 'rol_err_refused',
  no_version: 'rol_err_no_version',
  conflict: 'rol_err_conflict',
};

const isCall = (b: unknown): b is RoleCall =>
  typeof b === 'object' && b !== null && ACTIONS.some((a) => (b as { action?: unknown }).action === a);

/**
 * v3 `create`, `update` and `delete` actions of `roles/+page.server.ts`, as one admin route: a role is part of the
 * project file, so each call is a Doc edit on the draft (Q13), and `uses` shows what a deletion would break before it
 * is made. The answer carries the refusal in both page languages, as the participant routes do.
 */
export const POST: RequestHandler = async ({ request, params, locals, cookies }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!isCall(body)) return json({ error: 'Expected { action, … }.' }, { status: 400 });
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  const r = runRoleCall(auth.projectKey, auth.principal, locale, body);
  if (r.ok) return json(r.body, { status: body.action === 'create' ? 201 : 200 });
  const key = REFUSAL[r.code];
  return json(
    {
      error: r.code,
      ...(r.detail ? { detail: r.detail } : {}),
      message: { de: adminMessage('de', key), en: adminMessage('en', key) },
    },
    { status: r.code === 'conflict' ? 409 : 400 },
  );
};
