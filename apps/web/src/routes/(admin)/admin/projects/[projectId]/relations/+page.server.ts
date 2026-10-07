import { error } from '@sveltejs/kit';
import { adminOf } from '../../../../../../lib/admin/projects/admin-guard.server';
import { loadRelations } from './relations.server';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { LOCALE_COOKIE, resolveLocale } from '../../../shell/locale';
import type { PageServerLoad } from './$types';

/** v3 `relations/+page.server.ts` (load): the project's relations and the feature types to pick from. */
export const load: PageServerLoad = ({ locals, url, params, cookies, request }) => {
  const admin = adminOf(locals, url);
  const auth = authorizeAdmin(admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'No access to this project.');
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  return loadRelations(auth.projectKey, locale);
};
