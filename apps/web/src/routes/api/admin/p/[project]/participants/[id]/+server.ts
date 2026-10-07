import { participantRoute } from '$lib/server/handlers/admin';
export const PATCH = participantRoute('update');
export const DELETE = participantRoute('remove');
