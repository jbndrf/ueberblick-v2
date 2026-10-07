import { json } from '@sveltejs/kit';

/** Unknown `/api/**` paths, any method, answer 404 JSON instead of an HTML error page. */
const notFound = () => json({ error: 'not_found' }, { status: 404 });
export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
