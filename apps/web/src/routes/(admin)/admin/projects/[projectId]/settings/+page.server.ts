import { error } from '@sveltejs/kit';
import { adminOf } from '../../../../../../lib/admin/projects/admin-guard.server';
import { loadSettings } from './settings.server';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { LOCALE_COOKIE, resolveLocale } from '../../../shell/locale';
import type { PageServerLoad } from './$types';

/** v3 `settings/+page.server.ts` (load), for the two sections that exist: the draft's branding and default view. */
export const load: PageServerLoad = ({ locals, url, params, cookies, request }) => {
  const admin = adminOf(locals, url);
  const auth = authorizeAdmin(admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'No access to this project.');
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  return loadSettings(auth.projectKey, locale);
};
