import { json, type RequestHandler } from '@sveltejs/kit';
import { authorizeAdmin } from '../../../../../../../lib/server/authz';
import { adminMessage } from '../../../../shell/messages';
import { LOCALE_COOKIE, resolveLocale } from '../../../../shell/locale';
import { loadFilters } from '../filters.server';

/**
 * The data of the Filter & Felder section: the roles, the presets and the draft compiled for the filter builder
 * (WP-386). A read: a section that is never opened never pays for the compile.
 */
export const GET: RequestHandler = ({ params, locals, cookies, request }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  const r = loadFilters(auth.projectKey, locale);
  if (r.ok) return json(r.data);
  const key = r.code === 'no_version' ? 'settings_err_no_version' : 'settings_filters_unavailable';
  return json(
    {
      error: r.code,
      ...(r.detail ? { detail: r.detail } : {}),
      message: { de: adminMessage('de', key), en: adminMessage('en', key) },
    },
    { status: 409 },
  );
};
