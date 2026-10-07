import type { DeployedConfig } from '../../sync';
import type { TileService } from '../../tiles/service';
import type { ProjectAccessDeps } from '../shared/contract';
import { createTileHandlers, type TileHandlers } from './handlers';

/** What `tileHandlersFor` reads from a runtime (`Runtime` in apps/web satisfies it structurally). */
export interface TileRouteDeps extends ProjectAccessDeps {
  readonly tiles: TileService;
  readonly services: { deployed(projectKey: string): DeployedConfig | undefined };
}

const shared = new WeakMap<object, TileHandlers>();

/** The tile handlers of a runtime, memoised on it. */
export function tileHandlersFor(rt: TileRouteDeps): TileHandlers {
  let handlers = shared.get(rt);
  if (handlers === undefined) {
    handlers = createTileHandlers({
      auth: rt.auth,
      project: (k) => rt.project(k),
      deployed: (k) => rt.services.deployed(k),
      service: rt.tiles,
    });
    shared.set(rt, handlers);
  }
  return handlers;
}
