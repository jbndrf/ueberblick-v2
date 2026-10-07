import { instanceStoreFor } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';
import { localeOfRequest } from './accept-language';
import type { PageServerLoad } from './$types';

/** `/legal`: the instance's legal pages, public (v3 `legal/+page.server.ts`). */
export const load: PageServerLoad = ({ request }) => ({
  locale: localeOfRequest(request),
  pages: instanceStoreFor(runtime())
    .pages()
    .map((p) => ({ slug: p.slug, title: p.title })),
});
