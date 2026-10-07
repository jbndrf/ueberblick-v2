import { redirect } from '@sveltejs/kit';
import { rootTarget } from '$lib/server/handlers/auth';
import type { PageServerLoad } from './$types';

/** There is no start page: `/` leads to the work (the participant's map, else the builder), or to the sign-in. */
export const load: PageServerLoad = ({ locals }) => redirect(303, rootTarget(locals));
