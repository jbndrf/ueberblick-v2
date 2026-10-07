import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { WORKER_ASSETS_FILE } from './routing';

/**
 * WP-717: the worker bundles the app starts (sync, photo and pack writer, cluster, MapLibre's map worker). SvelteKit's
 * `$service-worker` `build` list leaves them out, so a cold start offline never got its sync worker. The list is read
 * from the client build output (never typed by hand, the names carry hashes) and written beside it as one file the
 * service worker reads at install, so there is one list (R1). Node-only: the build calls it.
 */

/** Every file below each of `dirs` (relative to the client output), as the URL path the browser requests. */
export function listWorkerAssets(clientDir: string, dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = join(clientDir, rel);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs).sort()) {
      const child = `${rel}/${name}`;
      if (statSync(join(clientDir, child)).isDirectory()) walk(child);
      else out.push(`/${child}`);
    }
  };
  for (const dir of dirs) walk(dir);
  return out;
}

/**
 * Writes the list of worker files next to the client build (`WORKER_ASSETS_FILE`) once the bundle is on disk, with
 * the worker bundles and MapLibre's files in it. The service worker fetches it at install.
 */
export function workerAssetsPlugin(dirs: readonly string[]): Plugin {
  return {
    name: 'worker-assets',
    apply: 'build',
    writeBundle(options) {
      if (this.environment.config.build.ssr || options.dir === undefined) return;
      const list = listWorkerAssets(options.dir, dirs);
      writeFileSync(join(options.dir, WORKER_ASSETS_FILE), JSON.stringify(list));
    },
  };
}
