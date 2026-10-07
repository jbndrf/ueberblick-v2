import { json, type RequestHandler } from '@sveltejs/kit';
import { authorizeAdmin } from '../../../../../../../lib/server/authz';
import { LOCALE_COOKIE, resolveLocale } from '../../../../shell/locale';
import { applyProjectFile, readProjectFile } from '../project-file.server';

/** `GET`: the draft's project file text and its revision. */
export const GET: RequestHandler = ({ params, locals }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  const r = readProjectFile(auth.projectKey, auth.principal.id);
  return r.ok ? json(r) : json({ error: 'no_version' }, { status: 404 });
};

/** `POST { text, revision }`: validates the file and applies it to the draft; nothing is applied on a problem. */
export const POST: RequestHandler = async ({ request, params, locals, cookies }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b['text'] !== 'string' || typeof b['revision'] !== 'number')
    return json({ error: 'Send { "text": string, "revision": number }.' }, { status: 400 });
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  const r = applyProjectFile(auth.projectKey, auth.principal, locale, b['text'], b['revision']);
  return r.ok ? json(r) : json(r, { status: r.conflict ? 409 : 400 });
};
