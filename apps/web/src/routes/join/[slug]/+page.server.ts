import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { view } from '../join-handlers';

/** GET: nothing is created here (link previews, bug B12). The page POSTs to `./start`. */
export const load: PageServerLoad = (event) => {
  const v = view(event);
  if (v.kind === 'refused') throw error(v.status, v.text);
  if (v.kind === 'go' || v.kind === 'consent') throw redirect(303, v.to);
  return { slug: v.slug, next: v.next };
};
