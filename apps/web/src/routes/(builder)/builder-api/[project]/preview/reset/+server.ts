import type { RequestHandler } from '@sveltejs/kit';
import { previewHandlers } from '../../../../../../lib/server/handlers/preview';

/** `POST /builder-api/<project>/preview/reset`: "Demo-Daten zurücksetzen"; the logins stay (WP-342, WP-373). */
export const POST: RequestHandler = (event) => previewHandlers.POST(event);
