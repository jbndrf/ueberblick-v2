import { tileUploadRoute } from '$lib/server/handlers/tile-upload';
export const GET = tileUploadRoute('status');
export const PUT = tileUploadRoute('chunk');
export const DELETE = tileUploadRoute('abort');
