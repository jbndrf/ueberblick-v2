import { error } from '@sveltejs/kit';
import { adminOf } from '../../../../../../lib/admin/projects/admin-guard.server';
import { loadParticipants } from './roster.server';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { LOCALE_COOKIE, resolveLocale } from '../../../shell/locale';
import type { PageServerLoad } from './$types';

/**
 * v3 `participants/+page.server.ts`: the roster (guests only with `?showGuests=true`, as in v3), the roles and the
 * admin's own columns. Writes go to the admin routes (`/api/admin/p/<project>/participants…`), not to form actions.
 */
export const load: PageServerLoad = ({ locals, url, params, cookies, request }) => {
  const admin = adminOf(locals, url);
  const auth = authorizeAdmin(admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'No access to this project.');
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  return loadParticipants(auth.projectKey, url.searchParams.get('showGuests') === 'true', locale);
};
