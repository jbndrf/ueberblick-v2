import { adminFeaturesRoute } from '$lib/server/handlers/admin-features';
export const GET = adminFeaturesRoute('list');
export const POST = adminFeaturesRoute('create');
