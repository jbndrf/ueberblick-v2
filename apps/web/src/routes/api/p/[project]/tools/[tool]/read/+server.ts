import type { RequestHandler } from '@sveltejs/kit';
import { toolHandlers } from '../../wiring';

export const POST: RequestHandler = ({ request, params }) =>
  toolHandlers().read(request, {
    params: { project: params['project'] ?? '', tool: params['tool'] ?? '' },
  });
