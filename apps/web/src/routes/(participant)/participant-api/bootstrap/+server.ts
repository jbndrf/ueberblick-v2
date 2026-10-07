import type { RequestHandler } from './$types';
import { participantApi } from '../wiring';

export const GET: RequestHandler = ({ request }) => participantApi().bootstrap(request);
