import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** The sign-in page moved to `/admin/login` (WP-320); an old `?next=` becomes `?redirectTo=`. */
export const GET: RequestHandler = ({ url }) => {
  const next = url.searchParams.get('next');
  redirect(303, next === null ? '/admin/login' : `/admin/login?redirectTo=${encodeURIComponent(next)}`);
};
