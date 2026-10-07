import { createProtokollHandler, versionCacheFor } from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import type { Call } from './http';

let handler: ReturnType<typeof createProtokollHandler> | undefined;
const protokoll = (): ReturnType<typeof createProtokollHandler> =>
  (handler ??= createProtokollHandler({
    authorizeAdmin,
    db: (key) => runtime().projectDb(key),
    versions: (key) => versionCacheFor(runtime().projectDb(key)),
  }));

/** `GET /api/admin/p/<project>/features/<id>/runs/<run>` (WP-372, owner A3: the Protokoll of one past run). */
export const adminProtokollRoute = (call: Call): Response =>
  protokoll()({ request: call.request, params: call.params, principal: call.locals.admin });
