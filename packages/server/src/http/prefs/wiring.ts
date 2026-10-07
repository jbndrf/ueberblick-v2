import type { Clock } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { ProjectAccessDeps } from '../shared/contract';
import { createPrefsHandlers, type PrefsHandlers } from './handlers';

/** What `prefsHandlersFor` reads from a runtime (`Runtime` in apps/web satisfies it structurally). */
export interface PrefsRuntimeDeps extends ProjectAccessDeps {
  readonly clock: Clock;
  projectDb(key: string): Db;
}

const shared = new WeakMap<object, PrefsHandlers>();

/** The preference handlers of a runtime, memoised on it. Route files delegate here (`prefsHandlersFor(runtime()).get`). */
export function prefsHandlersFor(rt: PrefsRuntimeDeps): PrefsHandlers {
  let handlers = shared.get(rt);
  if (handlers === undefined) {
    handlers = createPrefsHandlers({
      auth: rt.auth,
      project: (k) => rt.project(k),
      clock: rt.clock,
      projectDb: (k) => rt.projectDb(k),
    });
    shared.set(rt, handlers);
  }
  return handlers;
}
