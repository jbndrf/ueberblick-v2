import type { RequestHandler } from '@sveltejs/kit';
import { previewHandlers } from '../../../../../lib/server/handlers/preview';

/** `GET /builder-api/<project>/preview`: how the preview follows the draft, with its logins (WP-341, WP-373). */
export const GET: RequestHandler = (event) => previewHandlers.GET(event);
