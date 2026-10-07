import type { RequestHandler } from '@sveltejs/kit';
import { instanceHandlersFor } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';

export const GET: RequestHandler = ({ request }) =>
  instanceHandlersFor(runtime()).legalList(request, { params: { slug: '' } });
