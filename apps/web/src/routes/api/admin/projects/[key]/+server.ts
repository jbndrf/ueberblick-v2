import { adminProjectDeleteHandlers } from '$lib/server/handlers/admin-project-delete';

/** `GET` counts, `DELETE` removes the project (WP-388, A-037). */
export const GET = adminProjectDeleteHandlers.GET;
export const DELETE = adminProjectDeleteHandlers.DELETE;
