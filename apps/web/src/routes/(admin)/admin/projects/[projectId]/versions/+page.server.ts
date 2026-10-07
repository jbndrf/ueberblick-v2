import { error } from '@sveltejs/kit';
import { pinCounts } from '@ueberblick/server';
import { adminOf } from '../../../../../../lib/admin/projects/admin-guard.server';
import { loadVersionsPage } from '../../../../../../lib/admin/versions/service.server';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { runtime } from '../../../../../../lib/server/runtime';
import type { PageServerLoad } from './$types';

/**
 * The Versionen page (v3 `releases/+page.server.ts`, "Releases"): the list of config versions, read through the same
 * Versions service as the builder routes, and the Objekte still pinned to each old version (`pinned`, WP-368). The
 * page's calls (rollback, compare, upgrade) go to the builder routes `/builder-api/<project>/...`; "Entwurf verwerfen"
 * is `discard/+server.ts` and "Auf aktuelle Version verschieben" is `move/+server.ts`, both next to this file.
 */
export const load: PageServerLoad = ({ locals, url, params }) => {
  adminOf(locals, url);
  const auth = authorizeAdmin(locals.admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'Admin access required.');
  return {
    project: auth.projectKey,
    ...loadVersionsPage(auth.projectKey),
    pinned: pinCounts(runtime().projectDb(auth.projectKey)),
  };
};
