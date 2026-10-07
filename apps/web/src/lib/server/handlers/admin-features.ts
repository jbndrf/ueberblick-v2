import {
  createAdminFeatureHandlers,
  createServerIds,
  projectStoresFor,
  type AdminFeaturesHandlers,
} from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import type { Call } from './http';

/** The e-mail of an admin account (the name its runs show under in the history), or null for an unknown id. */
export const adminName = (accountId: string): string | null =>
  runtime()
    .control.prepare<{ email: string | null }>('SELECT email FROM accounts WHERE id = ?')
    .get(accountId)?.email ?? null;

let handlers: AdminFeaturesHandlers | undefined;
const features = (): AdminFeaturesHandlers =>
  (handlers ??= createAdminFeatureHandlers({
    authorizeAdmin,
    db: (key) => runtime().projectDb(key),
    deployed: (key) => runtime().services.deployed(key),
    store: projectStoresFor(runtime()),
    ids: createServerIds(runtime().clock),
    clock: runtime().clock,
    adminName,
  }));

/**
 * `GET /api/admin/p/<project>/features`, `…/features/distinct` (E-7: the data table), `…/features/<id>/history` (E-9: the
 * detail page) and `POST …/features/<id>/correct` (E-11: the Admin-Korrektur of the data page), `POST …/features` (E-12: a new row) and `POST …/features/<id>/lifecycle` (E-13: delete).
 */
export const adminFeaturesRoute =
  (name: keyof AdminFeaturesHandlers) =>
  (call: Call): Response | Promise<Response> =>
    features()[name]({ request: call.request, params: call.params, principal: call.locals.admin });
