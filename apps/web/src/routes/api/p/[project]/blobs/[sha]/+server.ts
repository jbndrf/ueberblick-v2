import type { RequestHandler } from '@sveltejs/kit';
import { participantBlobHandlers } from '../../wiring';

const params = (p: Record<string, string | undefined>) => ({
  params: { project: p['project'] ?? '', sha: p['sha'] ?? '' },
});

export const PUT: RequestHandler = ({ request, params: p }) =>
  participantBlobHandlers().put(request, params(p));
export const HEAD: RequestHandler = ({ request, params: p }) =>
  participantBlobHandlers().head(request, params(p));
export const GET: RequestHandler = ({ request, params: p }) =>
  participantBlobHandlers().get(request, params(p));
