import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../scripts/testing/plant.mjs';

const repo = resolve(import.meta.dirname, '../../../..');
const builderRoutes = join(repo, 'apps/web/src/routes/(builder)');
/** The admin area (rebuild step 4) hosts the ported v3 builder pages. */
const adminRoutes = join(repo, 'apps/web/src/routes/(admin)');
/** The assistant endpoint (WP-211) is a server route: it is never part of a page bundle, so it may use the builder's headless model. */
const mcpRoutes = join(repo, 'apps/web/src/routes/api/mcp');
/** The browser client of the Versions routes implements the builder's `VersionsApi`; it is imported by (builder) routes only (WP-326). */
const versionsClient = 'apps/web/src/lib/admin/draft/versions-client.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '.svelte-kit' || name === 'paraglide') return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('builder code stays out of the participant bundle', () => {
  const participantRoots = [
    'packages/core/src',
    'packages/client/src',
    'packages/server/src',
    'packages/ui/src',
    'packages/tools',
    'apps/web/src',
  ]
    .map((r) => join(repo, r))
    .filter(existsSync);

  const sources = participantRoots
    .flatMap(walk)
    .filter((f) => /\.(ts|js|svelte|mjs)$/.test(f))
    .filter(
      (f) =>
        !f.startsWith(builderRoutes) &&
        !f.startsWith(adminRoutes) &&
        !f.startsWith(mcpRoutes) &&
        !f.endsWith('.spec.ts') &&
        !f.endsWith(versionsClient) &&
        !isPlanted(f),
    );

  it('scans a real set of files', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('nothing outside the builder imports @ueberblick/builder, except the (builder) and (admin) routes and the MCP endpoint', () => {
    const offenders = sources.filter((f) => /@ueberblick\/builder/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(repo, f))).toEqual([]);
  });

  it('the participant packages do not depend on the builder package', () => {
    for (const pkg of ['core', 'client', 'server', 'ui']) {
      const file = join(repo, 'packages', pkg, 'package.json');
      if (!existsSync(file)) continue;
      expect(readFileSync(file, 'utf8')).not.toContain('@ueberblick/builder');
    }
  });

  it('builder pages are the only routes that load it (a route chunk per area)', () => {
    const users = walk(join(repo, 'apps/web/src'))
      .filter((f) => /\.(ts|svelte)$/.test(f) && !isPlanted(f))
      .filter((f) => /@ueberblick\/builder/.test(readFileSync(f, 'utf8')))
      .filter((f) => !f.endsWith(versionsClient))
      .map((f) => relative(join(repo, 'apps/web/src/routes'), f));
    expect(users.length).toBeGreaterThan(0);
    for (const u of users)
      expect(u.startsWith('(builder)/') || u.startsWith('(admin)/') || u.startsWith('api/mcp/')).toBe(true);
  });
});
