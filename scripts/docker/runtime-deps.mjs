// Runtime dependencies of the built web app (WP-952), derived from apps/web/package.json and never hand-picked.
// adapter-node keeps `dependencies` external; workspace packages (@ueberblick/*) are bundled into the build.
// `node scripts/docker/runtime-deps.mjs <outDir>` writes <outDir>/package.json with those dependencies pinned
// to the versions installed in the repo's node_modules (the lockfile's), for `npm install --omit=dev`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Names of all workspace packages of the repo (they are bundled, not installed). */
export function workspaceNames(root = ROOT) {
  const names = new Set();
  for (const glob of readJson(join(root, 'package.json')).workspaces ?? []) {
    const base = glob.replace(/\/\*$/, '');
    const dirs = glob.endsWith('/*')
      ? (existsSync(join(root, base)) ? readdirSync(join(root, base)) : []).map((d) => join(base, d))
      : [base];
    for (const d of dirs) {
      const pkg = join(root, d, 'package.json');
      if (existsSync(pkg)) names.add(readJson(pkg).name);
    }
  }
  return names;
}

/** The external runtime dependencies of apps/web: { name: range }. */
export function externalRuntimeDeps(root = ROOT, webPackageJson = join(root, 'apps/web/package.json')) {
  const bundled = workspaceNames(root);
  return Object.fromEntries(
    Object.entries(readJson(webPackageJson).dependencies ?? {}).filter(([name]) => !bundled.has(name)),
  );
}

/** Same set, pinned to the installed version (the lockfile's). */
export function pinnedRuntimeDeps(root = ROOT) {
  return Object.fromEntries(
    Object.keys(externalRuntimeDeps(root)).map((name) => [
      name,
      readJson(join(root, 'node_modules', name, 'package.json')).version,
    ]),
  );
}

/**
 * Static guard: which external runtime dependencies would the Dockerfile's runtime stage lack?
 * A Dockerfile that derives them (runs this script and installs with npm, no hand-copied modules) misses none;
 * otherwise every dependency must at least be named in it.
 */
export function missingRuntimeDeps(dockerfile, deps) {
  const derived =
    /scripts\/docker\/runtime-deps\.mjs/.test(dockerfile) &&
    /npm (install|ci)[^\n]*--omit=dev/.test(dockerfile) &&
    !/COPY[^\n]*node_modules\/\S+ \S*node_modules\/\S/.test(dockerfile);
  return derived ? [] : Object.keys(deps).filter((name) => !dockerfile.includes(name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) throw new Error('usage: runtime-deps.mjs <outDir>');
  mkdirSync(out, { recursive: true });
  const pkg = {
    name: 'ueberblick-runtime',
    private: true,
    type: 'module',
    dependencies: pinnedRuntimeDeps(),
  };
  writeFileSync(join(out, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}
