import { createGeo } from '@ueberblick/core';
import {
  createAdminImportHandlers,
  createImportService,
  createServerIds,
  projectStoresFor,
  type AdminImportHandlers,
} from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import type { Call } from './http';

let handlers: AdminImportHandlers | undefined;
const imports = (): AdminImportHandlers =>
  (handlers ??= createAdminImportHandlers({
    authorizeAdmin,
    deployed: (key) => runtime().services.deployed(key),
    service: createImportService({
      db: (key) => runtime().projectDb(key),
      store: projectStoresFor(runtime()),
      clock: runtime().clock,
      ids: createServerIds(runtime().clock),
      geo: createGeo(),
    }),
  }));

/** `POST …/import/plan`, `POST …/import` and `GET …/import/<job>` (E-10): the import wizard's engine. */
export const adminImportRoute =
  (name: keyof AdminImportHandlers) =>
  (call: Call): Response | Promise<Response> =>
    imports()[name]({ request: call.request, params: call.params, principal: call.locals.admin });
