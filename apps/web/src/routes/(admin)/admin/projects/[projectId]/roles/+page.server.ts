import { error } from '@sveltejs/kit';
import { adminOf } from '../../../../../../lib/admin/projects/admin-guard.server';
import { loadRoles } from './roles.server';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { LOCALE_COOKIE, resolveLocale } from '../../../shell/locale';
import type { PageServerLoad } from './$types';

/** v3 `roles/+page.server.ts` (load): the project's roles with who has each, and the roster for the members dialog. */
export const load: PageServerLoad = ({ locals, url, params, cookies, request }) => {
  const admin = adminOf(locals, url);
  const auth = authorizeAdmin(admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'No access to this project.');
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  return loadRoles(auth.projectKey, locale);
};
