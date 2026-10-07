import type { RequestHandler } from '@sveltejs/kit';
import { participantPrefsHandlers } from '../wiring';

const ctx = (params: Record<string, string | undefined>) => ({
  params: { project: params['project'] ?? '' },
});

export const GET: RequestHandler = ({ request, params }) =>
  participantPrefsHandlers().get(request, ctx(params));
export const PATCH: RequestHandler = ({ request, params }) =>
  participantPrefsHandlers().patch(request, ctx(params));
export const DELETE: RequestHandler = ({ request, params }) =>
  participantPrefsHandlers().remove(request, ctx(params));
