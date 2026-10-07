import { adminExportHandlers } from '$lib/server/handlers/admin-export';

/** `POST /api/admin/projects/import-zip` (WP-384): "ZIP importieren", the ZIP as the raw body; answers a job. */
export const POST = adminExportHandlers.importZip;
