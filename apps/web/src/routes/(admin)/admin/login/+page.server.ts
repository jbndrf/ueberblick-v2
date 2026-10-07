import { redirect } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { redirectTarget } from '../shell/redirect';
import type { PageServerLoad } from './$types';

/** v3 `login/+page.server.ts`: a signed-in admin goes on at once; `redirectTo` is followed only when it is a same-origin path; `totp` is `ADMIN_TOTP`, `rememberDays` the "stay signed in" length (WP-942). */
export const load: PageServerLoad = ({ locals, url }) => {
  const redirectTo = redirectTarget(url.searchParams.get('redirectTo'));
  if (locals.admin?.kind === 'admin') redirect(303, redirectTo);
  return { redirectTo, totp: config().adminTotp, rememberDays: config().sessionDays.adminRemember };
};
