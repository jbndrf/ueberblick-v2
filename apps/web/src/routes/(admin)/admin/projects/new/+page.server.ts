import { listTemplates } from '@ueberblick/server';
import { adminOf } from '../../../../../lib/admin/projects/admin-guard.server';
import { templateRef } from '../../../../../lib/admin/projects/create-client';
import { runtime } from '../../../../../lib/server/runtime';
import type { PageServerLoad } from './$types';

/** The template select (Q10): `leer` first, then the published templates by key. Creating goes through the API. */
export const load: PageServerLoad = ({ locals, url }) => {
  adminOf(locals, url);
  const rt = runtime();
  const templates = listTemplates(rt.control, rt.clock);
  const first = templates[0];
  return { templates, defaultTemplate: first ? templateRef(first) : '' };
};
