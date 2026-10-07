import { createServerIds } from '../shared/ids';
import type { ProjectAccessDeps } from '../shared/contract';
import type { ProjectServices } from '../shared/services';
import { projectStoresFor, type ProjectStoresDeps } from '../shared/stores';
import { createOgcHandlers, type OgcHandlers } from './handlers';
import type { OgcSeams } from './seams';

const shared = new WeakMap<object, OgcHandlers>();

/** The runtime pieces the OGC handlers read from (`Runtime` in apps/web satisfies it). */
export type OgcRuntime = ProjectAccessDeps &
  ProjectStoresDeps & { readonly services: Pick<ProjectServices, 'sync' | 'deployed'> };

/** The OGC handlers of a runtime, memoised on it. Route files delegate here (`ogcHandlersFor(runtime()).handle`). */
export function ogcHandlersFor(rt: OgcRuntime, seams?: Partial<OgcSeams>): OgcHandlers {
  let handlers = shared.get(rt);
  if (handlers === undefined) {
    handlers = createOgcHandlers({
      auth: rt.auth,
      project: (k) => rt.project(k),
      db: (k) => rt.projectDb(k),
      store: projectStoresFor(rt),
      sync: (k) => rt.services.sync(k),
      deployed: (k) => rt.services.deployed(k),
      clock: rt.clock,
      ids: createServerIds(rt.clock),
      ...(seams ? { seams } : {}),
    });
    shared.set(rt, handlers);
  }
  return handlers;
}
