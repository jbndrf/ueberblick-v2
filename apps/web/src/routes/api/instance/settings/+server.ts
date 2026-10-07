import type { RequestHandler } from '@sveltejs/kit';
import { instanceHandlersFor } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';

const ctx = { params: { slug: '' } };
export const GET: RequestHandler = ({ request }) => instanceHandlersFor(runtime()).settingsGet(request, ctx);
export const PUT: RequestHandler = ({ request }) => instanceHandlersFor(runtime()).settingsPut(request, ctx);
