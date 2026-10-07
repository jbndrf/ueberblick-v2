import { createAdminAssetHandlers, createBlobs, type AdminAssetsHandlers } from '@ueberblick/server';
import type { RequestHandler } from '@sveltejs/kit';
import { authorizeAdmin } from '$lib/server/authz';
import { json } from '$lib/server/handlers/http';
import { runtime } from '$lib/server/runtime';

let handlers: AdminAssetsHandlers | undefined;
const assets = (): AdminAssetsHandlers =>
  (handlers ??= createAdminAssetHandlers({
    authorizeAdmin,
    blobs: (key) =>
      createBlobs({
        db: runtime().projectDb(key),
        store: runtime().blobs.store(key),
        clock: runtime().clock,
      }),
  }));

/** `POST /api/admin/p/<project>/assets` (A-036): upload the project icon; the answer carries the sha for `branding.icon`. */
export const POST: RequestHandler = ({ request, params, locals }) =>
  request.headers.get('sec-fetch-site') !== 'same-origin'
    ? Promise.resolve(json({ error: 'An upload must come from the admin app (same origin).' }, 403))
    : assets().upload({ request, params, principal: locals.admin });
