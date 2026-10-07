import { adminTemplatesHandlers } from '$lib/server/handlers/admin-templates';

/** `POST /api/admin/projects/import` (WP-383): "Aus Datei importieren", a new project from a project file. */
export const POST = adminTemplatesHandlers.POST_IMPORT;
