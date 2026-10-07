import type { RequestHandler } from '@sveltejs/kit';
import { toolHandlers } from '../wiring';

const ctx = (params: Record<string, string | undefined>) => ({
  params: { project: params['project'] ?? '', tool: params['tool'] ?? '' },
});

export const GET: RequestHandler = ({ request, params }) => toolHandlers().list(request, ctx(params));
export const POST: RequestHandler = ({ request, params }) => toolHandlers().send(request, ctx(params));
