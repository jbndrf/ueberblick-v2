import type { RequestHandler } from './$types';
import { syncHandlers } from '../wiring';

export const GET: RequestHandler = ({ request, params, locals }) =>
  syncHandlers().events({
    request,
    project: params.project,
    principal: locals.participant,
    fallback: locals.admin,
  });
