import { listProjects, listTemplates } from '@ueberblick/server';
import { adminOf } from '../../../../lib/admin/projects/admin-guard.server';
import { runtime } from '../../../../lib/server/runtime';
import type { PageServerLoad } from './$types';

/** v3 `projects/+page.server.ts:16-28`: the admin's projects, newest first. Called directly, not through the API. */
export const load: PageServerLoad = ({ locals, url }) => {
  const admin = adminOf(locals, url);
  const rt = runtime();
  return {
    projects: listProjects(rt.control, rt.projectDb, admin.id),
    // the version the "Als Vorlage veröffentlichen" dialog suggests (WP-383)
    templates: listTemplates(rt.control, rt.clock).map((t) => ({ key: t.key, version: t.version })),
  };
};
