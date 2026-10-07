import { error } from '@sveltejs/kit';
import { LEGAL_SLUG, instanceStoreFor } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';
import { localeOfRequest } from '../accept-language';
import type { PageServerLoad } from './$types';

/** `/legal/<slug>`: one legal page, public; 404 for an unknown or malformed slug (v3 `legal/[slug]/+page.server.ts`). */
export const load: PageServerLoad = ({ params, request }) => {
  const page = LEGAL_SLUG.test(params.slug) ? instanceStoreFor(runtime()).page(params.slug) : undefined;
  if (page === undefined) error(404, 'Page not found');
  return {
    locale: localeOfRequest(request),
    page: { slug: page.slug, title: page.title, body: page.body },
  };
};
