import { listProjects } from '@ueberblick/server';
import { json } from '@sveltejs/kit';
import { projectsHandlers } from '../../../../lib/server/handlers/projects-wiring';
import { runtime } from '../../../../lib/server/runtime';
import type { RequestHandler } from './$types';

export const POST = projectsHandlers.POST;

/** `GET /api/admin/projects` (WP-323, E-1): the projects the signed-in admin is a member of, newest first. */
export const GET: RequestHandler = ({ locals }) => {
  const principal = locals.admin;
  if (principal === null) return json({ error: 'Sign in first.' }, { status: 401 });
  if (principal.kind !== 'admin') return json({ error: 'Admin access required.' }, { status: 403 });
  const rt = runtime();
  return json(listProjects(rt.control, rt.projectDb, principal.id));
};
