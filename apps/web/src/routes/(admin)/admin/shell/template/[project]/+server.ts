import { json, type RequestHandler } from '@sveltejs/kit';
import { authorizeAdmin } from '$lib/server/authz';
import { openDraft } from '$lib/admin/draft/draft-source.server';

/**
 * `GET /admin/shell/template/<project>`: the source of the template the project's draft extends. The sidebar's
 * browser client needs it to apply an op with the builder's `Doc` (the draft route names the template, it does not
 * carry it). Read on demand, so no page load ships it.
 */
export const GET: RequestHandler = ({ params, locals }) => {
  const auth = authorizeAdmin(locals.admin, params.project ?? '');
  if (auth instanceof Response) return auth;
  const draft = openDraft(auth.projectKey, auth.principal.id);
  if (draft === null)
    return json({ error: 'No version is deployed, so there is nothing to edit yet.' }, { status: 404 });
  return json({ templateSrc: draft.templateSrc }, { headers: { 'cache-control': 'private, no-store' } });
};
