import { adminExportHandlers } from '$lib/server/handlers/admin-export';

/** `GET /api/admin/p/<project>/export/gpkg` (WP-384, S3-8): the ⋮ menu's export of the Projekte page. */
export const GET = adminExportHandlers.gpkg;
