// Component e2e suites (WP-951): every <workspace>/src/**/e2e/playwright.config.ts is a suite of its own. The workspaces
// are the root package.json's `workspaces` (packages/*, packages/tools/*, apps/*), so a new workspace dir is found too.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Collects every directory named `e2e` below `dir` that holds a playwright.config.ts. */
function walk(dir, found) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.name === 'e2e') {
      if (existsSync(join(full, 'playwright.config.ts'))) found.push(full);
    } else walk(full, found);
  }
}

/** The workspace dirs (relative to `root`) from the root package.json's `workspaces`; only `<dir>/*` globs are allowed. */
export function workspaceDirs(root) {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return [];
  const globs = JSON.parse(readFileSync(manifest, 'utf8')).workspaces ?? [];
  const dirs = [];
  for (const g of globs) {
    if (!/^[\w./-]+\/\*$/.test(g))
      throw new Error(`discover: unsupported workspaces glob "${g}" (only "<dir>/*")`);
    const parent = g.slice(0, -2);
    if (!existsSync(join(root, parent))) continue;
    for (const e of readdirSync(join(root, parent), { withFileTypes: true }))
      if (e.isDirectory()) dirs.push(`${parent}/${e.name}`);
  }
  return dirs;
}

/** The id stem of a workspace dir: without its leading `packages/` or `apps/`, slashes as dashes (`packages/tools/file` → `tools-file`). */
const stemOf = (dir) => dir.replace(/^(packages|apps)\//, '').replace(/\//g, '-');

/** Suite entries for the component configs under `root`, sorted by id. None gives []. */
export function discoverSuites(root) {
  const suites = [];
  for (const dir of workspaceDirs(root)) {
    const src = join(root, dir, 'src');
    if (!existsSync(src)) continue;
    const found = [];
    walk(src, found);
    for (const e2eDir of found) {
      const path = relative(src, e2eDir).split(sep).slice(0, -1); // <path...> between src and e2e
      const id = path.length ? `comp:${stemOf(dir)}/${path.join('-')}` : `comp:${stemOf(dir)}`;
      suites.push({
        id,
        name: [dir, 'src', ...path].join('/'),
        config: [dir, 'src', ...path, 'e2e', 'playwright.config.ts'].join('/'),
        report: `apps/web/test-results/e2e-${id.replace(/[:/]/g, '-')}-report.json`,
      });
    }
  }
  return suites.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The env names a discovered suite's config reads for its port and data dir, derived from its id. */
export function portEnvFor(id) {
  const key = id
    .replace(/^comp:/, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .toUpperCase();
  return { port: `E2E_COMP_${key}_PORT`, dir: `E2E_COMP_${key}_DATA_DIR` };
}

/** The `{ suite, path }` pairs triage reads: one per suite, with the report resolved against `root`. */
export function reportTargets(suites, root) {
  return suites.map((s) => ({ suite: s.name, path: join(root, s.report) }));
}
