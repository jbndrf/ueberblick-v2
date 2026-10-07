import { join } from 'node:path';
import type { Db } from '../../db/driver';
import type { DeployedConfig } from '../../sync';
import type { ProjectAccessDeps } from '../shared/contract';
import { createPackHandlers, type PackHandlers } from './handlers';

/** What `packHandlersFor` reads from a runtime (`Runtime` in apps/web satisfies it structurally). */
export interface PackRouteDeps extends ProjectAccessDeps {
  projectDb(key: string): Db;
  /** Where the build job of the project writes (`packsDir(dataDir, key)`). */
  packsDir(projectKey: string): string;
  readonly services: { deployed(projectKey: string): DeployedConfig | undefined };
}

const shared = new WeakMap<object, PackHandlers>();

/** The pack handlers of a runtime, memoised on it. The files are read from `rt.packsDir`. */
export function packHandlersFor(rt: PackRouteDeps): PackHandlers {
  let handlers = shared.get(rt);
  if (handlers === undefined) {
    handlers = createPackHandlers({
      auth: rt.auth,
      project: (k) => rt.project(k),
      projectDb: (k) => rt.projectDb(k),
      deployed: (k) => rt.services.deployed(k),
      dir: (k) => rt.packsDir(k),
    });
    shared.set(rt, handlers);
  }
  return handlers;
}

/** Where the build job of a project writes: `<dataDir>/blobs/packs/<project>` (A-032 item 2). */
export const packsDir = (dataDir: string, projectKey: string): string =>
  join(dataDir, 'blobs', 'packs', projectKey);
