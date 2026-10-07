import { adminTemplatesHandlers } from '$lib/server/handlers/admin-templates';
import { projectsHandlers } from '$lib/server/handlers/projects-wiring';

export const GET = projectsHandlers.GET_TEMPLATES;
/** `POST /api/admin/templates` (WP-383): "Als Vorlage veröffentlichen". */
export const POST = adminTemplatesHandlers.POST;
