import { adminExportHandlers } from '$lib/server/handlers/admin-export';

/** `GET /api/admin/projects/import-zip/<job>` (WP-384): progress and outcome of a ZIP import. */
export const GET = adminExportHandlers.importZipStatus;
