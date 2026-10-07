import { error } from '@sveltejs/kit';
import { adminOf } from '../../../../../../../lib/admin/projects/admin-guard.server';
import { loadTablePage } from '../../../../../../../lib/admin/tables/load.server';
import { authorizeAdmin } from '../../../../../../../lib/server/authz';
import type { PageServerLoad } from './$types';

/**
 * The page of one table (v3 `custom-tables/[tableId]/+page.server.ts`): the table's name, description, roles and columns
 * from the project's draft, and the type as deployed for the grid. The rows are not loaded here: the grid asks the
 * admin feature list API, page by page.
 */
export const load: PageServerLoad = async ({ locals, url, params, parent }) => {
  const principal = adminOf(locals, url);
  const auth = authorizeAdmin(locals.admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'Admin access required.');
  const { locale } = await parent();
  const page = loadTablePage(auth.projectKey, principal.id, locale, params.type);
  if (page === null) error(404, 'Unknown table.');
  return { project: auth.projectKey, key: params.type, ...page };
};
