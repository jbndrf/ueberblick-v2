import { adminTemplatesHandlers } from '$lib/server/handlers/admin-templates';

/** `GET /api/admin/projects/<project>/schema` (WP-383): "Schema exportieren", the effective file as YAML. */
export const GET = adminTemplatesHandlers.GET_SCHEMA;
