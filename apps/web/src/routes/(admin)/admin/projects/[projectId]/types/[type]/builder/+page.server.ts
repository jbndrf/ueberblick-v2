import { error, redirect } from '@sveltejs/kit';
import { authorizeAdmin } from '$lib/server/authz';
import { openDraft } from '../../../../../../../../lib/admin/draft/draft-source.server';
import { draftHasType } from './type-check';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
  // Anonymous visitors sign in first and come back here; a signed-in admin without membership gets 403.
  if (locals.admin === null)
    redirect(303, `/builder/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const auth = authorizeAdmin(locals.admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'Admin access required.');
  const draft = openDraft(auth.projectKey, auth.principal.id);
  if (draft !== null && !draftHasType(draft.templateSrc, draft.overlaySrc, params.type))
    error(404, 'Unknown feature type.');
  return { project: auth.projectKey, type: params.type, draft };
};
