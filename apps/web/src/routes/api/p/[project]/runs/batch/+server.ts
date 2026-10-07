import type { RequestHandler } from '@sveltejs/kit';
import { participantRunHandlers } from '../../wiring';

export const POST: RequestHandler = ({ request, params }) =>
  participantRunHandlers().batch(request, { params: { project: params['project'] ?? '' } });
