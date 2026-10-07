import { mapOrigins } from '@ueberblick/core';
import { loadConfig, type Db } from '@ueberblick/server';

/** What the set is computed from: every project (deployed config) and every live preview (the draft's config). */
export interface MapOriginSources {
  readonly keys: () => readonly string[];
  readonly db: (key: string) => Db;
}

/** The project's deployed map origins; a project without a deployed config or a map gives none. */
function originsOfKey(sources: MapOriginSources, key: string): string[] {
  const map = loadConfig(sources.db(key))?.file.map;
  return map === undefined ? [] : mapOrigins(map);
}

/**
 * The map origins the Content-Security-Policy allows: the union over all projects' deployed configs and all live
 * previews. A small cached set, recomputed on start and after each deploy (a preview refresh is a deploy of the
 * preview's database), never per request (R14). One set for the whole server, not per project: `mapOrigins` takes one
 * map, so scoping a page to its project's origins later is a change in `current` and its caller only (R13).
 */
export function createMapOriginsStore(sources: MapOriginSources) {
  let current: readonly string[] = [];
  const recompute = (): void => {
    const all = new Set<string>();
    for (const key of sources.keys()) {
      try {
        for (const o of originsOfKey(sources, key)) all.add(o);
      } catch {
        // a project whose stored config cannot be read contributes nothing; its own routes report the problem
      }
    }
    current = [...all].sort();
  };
  recompute();
  return { current: (): readonly string[] => current, recompute };
}
export type MapOriginsStore = ReturnType<typeof createMapOriginsStore>;

/**
 * Recomputes the set after every deploy. `ProjectServices.afterDeploy` is the one call every deploy path makes (admin
 * deploy, builder versions, MCP, preview refresh), so wrapping it here covers them all without each caller knowing
 * about the CSP.
 */
export function recomputeAfterDeploys(
  services: { afterDeploy(projectKey: string): void },
  store: MapOriginsStore,
): void {
  const inner = services.afterDeploy.bind(services);
  services.afterDeploy = (key) => {
    inner(key);
    store.recompute();
  };
}
