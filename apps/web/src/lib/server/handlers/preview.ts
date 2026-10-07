/**
 * The preview of a project for the admin (WP-341, WP-342, WP-373):
 *
 *   GET  /builder-api/<project>/preview[?locale=de]   { status, problems, version, updatedAt, logins }
 *   POST /builder-api/<project>/preview/reset         the same body: "Demo-Daten zurücksetzen", the logins stay
 *
 * `logins` are the preview logins (v3 "Vorschau-Logins"): one per role of the draft plus "Keine Rolle" (`role: null`),
 * each with its readable token and the relative link `/login?token=…`. They hold secrets, so both calls are the
 * project admin's only (401/403/404 from `authorizeAdmin`).
 */
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import { json, type Call } from './http';

function body(projectKey: string, locale: string | null): Response {
  const previews = runtime().previews;
  const state = previews.previewState(projectKey);
  return json({ ...state, logins: previews.previewLogins(projectKey, locale ?? undefined) }, 200, {
    'cache-control': 'no-store',
  });
}

export const previewHandlers = {
  GET(call: Call): Response {
    const auth = authorizeAdmin(call.locals.admin, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    return body(auth.projectKey, new URL(call.request.url).searchParams.get('locale'));
  },

  POST(call: Call): Response {
    const auth = authorizeAdmin(call.locals.admin, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    runtime().previews.resetPreview(auth.projectKey);
    return body(auth.projectKey, new URL(call.request.url).searchParams.get('locale'));
  },
};
