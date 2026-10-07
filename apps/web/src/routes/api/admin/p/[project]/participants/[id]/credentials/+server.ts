import { participantRoute } from '$lib/server/handlers/admin';
export const GET = participantRoute('credGet');
export const PUT = participantRoute('credSet');
export const POST = participantRoute('qrIssue');
export const DELETE = participantRoute('credRevoke');
