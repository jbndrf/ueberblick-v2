import type { RequestHandler } from '@sveltejs/kit';
import { instanceHandlersFor } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';

const ctx = (params: Record<string, string | undefined>) => ({ params: { slug: params['slug'] ?? '' } });

export const GET: RequestHandler = ({ request, params }) =>
  instanceHandlersFor(runtime()).legalPage(request, ctx(params));
export const PUT: RequestHandler = ({ request, params }) =>
  instanceHandlersFor(runtime()).pagePut(request, ctx(params));
export const PATCH: RequestHandler = ({ request, params }) =>
  instanceHandlersFor(runtime()).pageRename(request, ctx(params));
export const DELETE: RequestHandler = ({ request, params }) =>
  instanceHandlersFor(runtime()).pageDelete(request, ctx(params));
