import { createAdminPackHandlers, type AdminPacksHandlers } from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import type { Call } from './http';

let handlers: AdminPacksHandlers | undefined;
const packs = (): AdminPacksHandlers =>
  (handlers ??= createAdminPackHandlers({
    authorizeAdmin,
    db: (key) => runtime().projectDb(key),
    deployed: (key) => runtime().services.deployed(key),
    clock: runtime().clock,
    kick: (key) => runtime().packs.kick(key),
  }));

/** `GET /api/admin/p/<project>/packs` and `POST …/packs/<key>/rebuild` (A-032): offline pack build state, and the retry. */
export const adminPacksRoute =
  (name: keyof AdminPacksHandlers) =>
  (call: Call): Response =>
    packs()[name]({ request: call.request, params: call.params, principal: call.locals.admin });
