import { participantRoute } from '$lib/server/handlers/admin';
export const GET = participantRoute('list');
export const POST = participantRoute('add');
