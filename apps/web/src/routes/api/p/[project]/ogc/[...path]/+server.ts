import type { RequestHandler } from '@sveltejs/kit';
import { ogcHandlersFor } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';

/** OGC API Features (WP-110): every method the handler knows; it answers 405 for the rest. */
const handle: RequestHandler = ({ request, params }) =>
  ogcHandlersFor(runtime()).handle(request, {
    params: { project: params['project'] ?? '', path: params['path'] ?? '' },
  });

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
