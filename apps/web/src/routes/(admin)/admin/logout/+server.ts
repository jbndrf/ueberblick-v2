import { logoutAdmin } from '$lib/server/handlers/auth';
import type { RequestHandler } from './$types';

/** Ends the session (the admin session only, the participant session stays) and goes to the login page (v3 `logout/+server.ts`). */
export const POST: RequestHandler = (event) => {
  const done = logoutAdmin(event);
  const cookie = done.headers.get('set-cookie');
  const headers = new Headers({ location: '/admin/login' });
  if (cookie !== null) headers.set('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
};
