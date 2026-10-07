import { json } from '../../../../../../../lib/server/handlers/http';
import { authorizeAdmin } from '../../../../../../../lib/server/authz';
import { discardDraftOf } from '../../../../../../../lib/admin/versions/service.server';
import type { RequestHandler } from './$types';

/** "Entwurf verwerfen" (a3 row 99): the draft becomes the deployed version's overlay again (`DraftStore.reset`). */
export const POST: RequestHandler = ({ locals, params }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId);
  if (auth instanceof Response) return auth;
  return discardDraftOf(auth.projectKey, auth.principal.id)
    ? json({ ok: true })
    : json({ ok: false, reason: 'no_version' }, 409);
};
