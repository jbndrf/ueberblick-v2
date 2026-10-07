import { redirect } from '@sveltejs/kit';
import { ADMIN_HOME } from './shell/redirect';
import type { PageServerLoad } from './$types';

/** `/admin` is the project list (v3 `+page.server.ts`). */
export const load: PageServerLoad = () => {
  redirect(303, ADMIN_HOME);
};
