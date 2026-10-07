import { error } from '@sveltejs/kit';
import { adminOf } from '../../../../../../lib/admin/projects/admin-guard.server';
import { loadOverview } from '../../../../../../lib/admin/tables/load.server';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import type { PageServerLoad } from './$types';

/** The Tabellen overview (v3 `custom-tables/+page.server.ts`): the project's tables and roles, from its draft. */
export const load: PageServerLoad = async ({ locals, url, params, parent }) => {
  const principal = adminOf(locals, url);
  const auth = authorizeAdmin(locals.admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'Admin access required.');
  const { locale } = await parent();
  return { project: auth.projectKey, ...loadOverview(auth.projectKey, principal.id, locale) };
};
