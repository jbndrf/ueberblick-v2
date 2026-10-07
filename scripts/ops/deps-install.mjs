#!/usr/bin/env node
// `npm run deps:install` (WP-958): hardlink main's install when the lockfiles match and main's install is
// current, otherwise `npm ci`. The main checkout itself always gets `npm ci`.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultCi, ensureNodeModules } from './link-node-modules.mjs';

/** Installs and returns { action, reason, status }. `say` gets the one-line report. */
export function depsInstall({ worktree, main, npmCi = defaultCi, say = () => {} }) {
  const t0 = Date.now();
  const r = ensureNodeModules({
    worktree,
    ...(main ? { main } : {}),
    replace: true,
    npmCi: (cwd, reason) => {
      say(`deps:install: npm ci (${reason})`);
      return npmCi(cwd);
    },
  });
  if (r.action === 'linked') say(`deps:install: linked from main (${Date.now() - t0} ms)`);
  return r;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(depsInstall({ worktree: process.cwd(), say: console.log }).status);
}
