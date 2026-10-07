import type { RequestHandler } from '@sveltejs/kit';
import { instanceHandlersFor } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';

const ctx = { params: { slug: '' } };
export const GET: RequestHandler = ({ request }) => instanceHandlersFor(runtime()).consent(request, ctx);
export const POST: RequestHandler = ({ request }) => instanceHandlersFor(runtime()).decide(request, ctx);
