import type { ProjectAccessDeps } from '../shared/contract';
import { projectStoresFor, type ProjectStoresDeps } from '../shared/stores';
import { createRunHandlers, type RunHandlers } from './handlers';

const shared = new WeakMap<object, RunHandlers>();

/** The run handlers of a runtime, memoised on it. Route files delegate here (`runHandlersFor(runtime()).submit`). */
export function runHandlersFor(rt: ProjectAccessDeps & ProjectStoresDeps): RunHandlers {
  let handlers = shared.get(rt);
  if (handlers === undefined) {
    handlers = createRunHandlers({
      auth: rt.auth,
      log: rt.log,
      project: (k) => rt.project(k),
      store: projectStoresFor(rt),
    });
    shared.set(rt, handlers);
  }
  return handlers;
}
