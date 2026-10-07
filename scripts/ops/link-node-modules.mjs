#!/usr/bin/env node
// Gives an agent worktree its node_modules in about a second and a few MB: a hardlinked copy of the
// main checkout's install when both lockfiles match, otherwise `npm ci` (WP-904).
//
// Why hardlinks are safe here (proven in link-node-modules.spec.ts):
// - npm never rewrites a package file in place. An install, upgrade or uninstall on either side writes
//   new files and unlinks the old ones, which only breaks the link. The one file npm rewrites in place
//   is its hidden lockfile `node_modules/.package-lock.json`, so every top-level regular file is copied.
// - Tool caches written at runtime (.vite, .vite-temp, .cache) are never shared.
// - Workspace links are relative (`@ueberblick/core -> ../../packages/core`), so in the copy they
//   resolve to the worktree's own packages.
import { spawnSync, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Runtime caches inside node_modules: never shared, the worktree's tools recreate them. */
export const EXCLUDE = new Set(['.vite', '.vite-temp', '.cache']);
/** Written into the linked copy so humans and tools can tell it from an npm install. */
export const MARKER = '.linked-from-main';

/** The main checkout of the repo that contains `cwd` (the parent of the git common dir). */
export function mainCheckout(cwd) {
  const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  return dirname(common);
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/**
 * Does main's installed tree (npm's hidden lockfile) match its package-lock.json? A main checkout whose
 * lockfile moved on (git pull, a merge) without an install must not be copied. Optional packages for
 * other platforms are in the lockfile but never installed, so only non-optional ones must be present.
 */
export function installMatchesLock(lock, hidden) {
  const want = lock?.packages ?? {};
  const have = hidden?.packages ?? {};
  for (const [key, h] of Object.entries(have)) {
    const w = want[key];
    if (!w) return `installed ${key} is not in package-lock.json`;
    for (const f of ['version', 'integrity', 'resolved', 'link']) {
      if (w[f] !== h[f]) return `${key}: ${f} ${h[f]} installed, ${w[f]} locked`;
    }
  }
  for (const [key, w] of Object.entries(want)) {
    if (key.startsWith('node_modules/') && !w.optional && !have[key])
      return `${key} is locked but not installed`;
  }
  return null;
}

/**
 * Why the worktree cannot link main's install, or null when it can. `allowLockMismatch` (WP-968) skips
 * the lockfile comparison for a caller that knows the worktree's dependencies are irrelevant (a docs-only
 * branch); main's own install must still match main's lockfile.
 */
export function linkRefusal(worktree, main, { allowLockMismatch = false } = {}) {
  if (resolve(worktree) === resolve(main)) return 'this is the main checkout';
  const nm = join(main, 'node_modules');
  if (!existsSync(nm)) return 'main has no node_modules';
  const lockW = join(worktree, 'package-lock.json');
  const lockM = join(main, 'package-lock.json');
  if (!existsSync(lockM) || (!allowLockMismatch && !existsSync(lockW)))
    return 'a package-lock.json is missing';
  if (!allowLockMismatch && !readFileSync(lockW).equals(readFileSync(lockM)))
    return "package-lock.json differs from main's";
  const hidden = join(nm, '.package-lock.json');
  if (!existsSync(hidden)) return 'main has no node_modules/.package-lock.json';
  const stale = installMatchesLock(readJson(lockM), readJson(hidden));
  return stale ? `main's install is stale (${stale})` : null;
}

/** Hardlink `src` into `dest`: directories recursively via `cp -al`, top-level regular files copied. */
function linkDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  const linked = [];
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE.has(e.name)) continue;
    if (e.isFile()) copyFileSync(join(src, e.name), join(dest, e.name));
    else linked.push(join(src, e.name));
  }
  if (linked.length) execFileSync('cp', ['-al', '-t', dest, ...linked]);
}

/** node_modules dirs of workspace packages in main (npm puts conflicting versions there). */
function workspaceModules(main) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (existsSync(join(p, 'package.json')) && existsSync(join(p, 'node_modules')))
        out.push(relative(main, p));
      walk(p, depth + 1);
    }
  };
  walk(join(main, 'packages'), 1);
  walk(join(main, 'apps'), 1);
  return out;
}

/** Every `@scope/name` symlink in node_modules must resolve inside the worktree, never into main. */
function checkWorkspaceLinks(worktree) {
  const nm = join(worktree, 'node_modules');
  const root = realpathSync(worktree);
  for (const scope of readdirSync(nm).filter((n) => n.startsWith('@'))) {
    for (const n of readdirSync(join(nm, scope))) {
      const p = join(nm, scope, n);
      if (!lstatSync(p).isSymbolicLink()) continue;
      const target = realpathSync(p);
      if (!target.startsWith(root + '/')) return `${scope}/${n} resolves to ${target}, outside the worktree`;
    }
  }
  return null;
}

/** Remove the worktree's root and nested workspace installs (refuses anything that is main's). */
function removeInstall(worktree, main) {
  // Worktrees may live inside main's checkout, so compare against main's own node_modules dirs only.
  const mainDirs = [
    join(main, 'node_modules'),
    ...workspaceModules(main).map((ws) => join(main, ws, 'node_modules')),
  ]
    .filter((d) => existsSync(d))
    .map((d) => realpathSync(d));
  const dirs = [
    join(worktree, 'node_modules'),
    ...workspaceModules(main).map((ws) => join(worktree, ws, 'node_modules')),
  ];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const real = realpathSync(d);
    if (lstatSync(d).isSymbolicLink() || mainDirs.some((m) => real === m || real.startsWith(m + '/')))
      throw new Error(`refusing to remove ${d}: it resolves into main's node_modules`);
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

export const defaultCi = (cwd) =>
  spawnSync('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], { cwd, stdio: 'inherit' }).status ??
  1;

/**
 * `replace` swaps an existing install for the link when linking is possible (WP-958); otherwise the
 * existing one is left for `npm ci`. Never removes a node_modules that resolves into main's.
 * @param {{ worktree: string, main?: string, dryRun?: boolean, replace?: boolean, npmCi?: (cwd: string, reason: string) => number, allowLockMismatch?: boolean }} opts
 * @returns {{ action: 'exists' | 'linked' | 'npm-ci' | 'dry-run', reason: string, status: number }}
 */
export function ensureNodeModules({
  worktree,
  main = mainCheckout(worktree),
  dryRun = false,
  npmCi = defaultCi,
  replace = false,
  allowLockMismatch = false,
}) {
  const hasModules = existsSync(join(worktree, 'node_modules'));
  if (hasModules && !replace) return { action: 'exists', reason: 'node_modules already present', status: 0 };
  const refusal = linkRefusal(worktree, main, { allowLockMismatch });
  if (hasModules && !dryRun && !refusal) removeInstall(worktree, main);
  if (dryRun)
    return { action: 'dry-run', reason: refusal ? `would run npm ci: ${refusal}` : 'would link', status: 0 };
  if (!refusal) {
    linkDir(join(main, 'node_modules'), join(worktree, 'node_modules'));
    for (const ws of workspaceModules(main)) {
      if (existsSync(join(worktree, ws)))
        linkDir(join(main, ws, 'node_modules'), join(worktree, ws, 'node_modules'));
    }
    const bad = checkWorkspaceLinks(worktree);
    if (!bad) {
      writeFileSync(
        join(worktree, 'node_modules', MARKER),
        JSON.stringify({ main, at: new Date().toISOString() }) + '\n',
      );
      return { action: 'linked', reason: `hardlinked from ${main}/node_modules`, status: 0 };
    }
    rmSync(join(worktree, 'node_modules'), { recursive: true, force: true });
    return { action: 'npm-ci', reason: bad, status: npmCi(worktree, bad) };
  }
  return { action: 'npm-ci', reason: refusal, status: npmCi(worktree, refusal) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const r = ensureNodeModules({ worktree: process.cwd(), dryRun: process.argv.includes('--dry-run') });
  console.log(`link-node-modules: ${r.action} (${r.reason}) in ${Date.now() - t0} ms`);
  process.exit(r.status);
}
