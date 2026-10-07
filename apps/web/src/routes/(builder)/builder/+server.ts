import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** The project list moved to the admin shell (WP-320): `/builder` goes to `/admin/projects`. */
export const GET: RequestHandler = () => {
  redirect(303, '/admin/projects');
};
