#!/usr/bin/env node
// WP-1041: a checkout's @ueberblick/* packages must resolve INSIDE the checkout. A worktree without those
// links (node_modules missing or incomplete) makes node resolve upward, into the main checkout it sits in
// (agent worktrees live in <main>/.claude/worktrees/), so specs test main's packages and a green run says
// nothing about the branch. `npm test` and `check:changed` call requireOwnPackages first.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { depsInstall } from './deps-install.mjs';

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** Package directories matched by the root workspaces globs (`dir/*` or a plain dir). */
function workspaceDirs(root) {
  const out = [];
  for (const g of readJson(join(root, 'package.json')).workspaces ?? []) {
    if (g.endsWith('/*')) {
      const base = join(root, g.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const e of readdirSync(base, { withFileTypes: true }))
        if (e.isDirectory() && existsSync(join(base, e.name, 'package.json'))) out.push(join(base, e.name));
    } else if (existsSync(join(root, g, 'package.json'))) out.push(join(root, g));
  }
  return out;
}

/** The workspace packages whose node_modules link is missing or resolves outside `root`: [{ name, resolved }]. */
export function checkOwnPackages(root) {
  const real = realpathSync(root);
  const bad = [];
  for (const dir of workspaceDirs(root)) {
    const name = readJson(join(dir, 'package.json')).name;
    if (!name?.startsWith('@ueberblick/')) continue;
    let resolved = null;
    try {
      resolved = realpathSync(join(root, 'node_modules', name));
    } catch {
      /* missing: node would resolve it from a parent directory */
    }
    if (resolved === null || !resolved.startsWith(real + '/')) bad.push({ name, resolved });
  }
  return bad;
}

const defaultLink = (root) => {
  const r = depsInstall({ worktree: root, say: (l) => console.error(l) });
  if (r.status !== 0) throw new Error(`deps:install exited ${r.status}`);
};

/**
 * Checks, repairs once with `link(root)` (default: the deps:install linker) and re-checks.
 * Returns { ok, relinked, message } and never throws; `message` is the line to print (null when all is well).
 */
export function ensureOwnPackages(root, { link = defaultLink } = {}) {
  const first = checkOwnPackages(root);
  if (first.length === 0) return { ok: true, relinked: false, message: null };
  try {
    link(root);
  } catch {
    /* judged by the re-check below */
  }
  const left = checkOwnPackages(root);
  if (left.length > 0) {
    const b = left[0];
    return {
      ok: false,
      relinked: false,
      message: `own packages: ${b.name} resolves to ${b.resolved ?? 'nothing in this checkout (it would come from a parent directory)'}, outside ${root}; run rm -rf node_modules && npm run deps:install`,
    };
  }
  return {
    ok: true,
    relinked: true,
    message: `own packages: relinked (node_modules resolved ${first.map((b) => b.name).join(', ')} outside this checkout)`,
  };
}

/** For the CLI wrappers: prints the message, returns false when the caller must exit 1. */
export function requireOwnPackages(root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')) {
  const r = ensureOwnPackages(root);
  if (r.message) console.error(r.message);
  return r;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(requireOwnPackages().ok ? 0 : 1);
}
