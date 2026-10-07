#!/usr/bin/env node
// WP-997: the lint of `npm run check:changed`. ESLint and Prettier run on the files changed against the merge-base
// with main (committed, staged, unstaged, untracked) instead of the whole repo. A lint config change, or a diff that
// cannot be computed, lints the whole repo. `check:fast` and the train's `check` still lint everything, so type-aware
// rules that only fire on unchanged files show up there. Usage: node scripts/ops/lint-changed.mjs [ref=main]
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { changedFiles } from './changed-select.mjs';
import { mergeBase } from './changed-base.mjs';
import { plan } from './precommit.mjs';

/** Lint config files; a change to one can alter the verdict on any file. */
export const LINT_CONFIGS = /^(eslint\.config\.[cm]?js|\.prettierrc[^/]*|\.prettierignore|\.eslintignore)$/;
const PACKAGE_LINT_KEYS = ['eslintConfig', 'prettier'];

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Did the root package.json's lint keys change against `base` (an unreadable side counts as changed)? */
function packageLintKeysChanged(cwd, base) {
  let old = null;
  try {
    old = execFileSync('git', ['show', `${base}:package.json`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // new file at the base
  }
  let now = null;
  try {
    now = readFileSync(`${cwd}/package.json`, 'utf8');
  } catch {
    // deleted
  }
  const before = old === null ? null : parseJson(old);
  const after = now === null ? null : parseJson(now);
  if (!before || !after) return true;
  return PACKAGE_LINT_KEYS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

/**
 * What to lint. `{ scope: 'files', eslint, prettier, line }` or `{ scope: 'all', line }`; `line` says why.
 * Deleted files are never listed (`changedFiles` splits them off).
 */
export function lintPlan(cwd, ref) {
  let base;
  try {
    base = mergeBase(cwd, ref);
  } catch {
    return { scope: 'all', line: `lint: no merge-base with ${ref} -> whole repo` };
  }
  let changes;
  try {
    changes = changedFiles(cwd, base);
  } catch {
    return { scope: 'all', line: 'lint: diff not computable -> whole repo' };
  }
  const touched = [...changes.files, ...changes.deleted];
  const config = touched.find((f) => LINT_CONFIGS.test(f));
  if (config) return { scope: 'all', line: `lint: ${config} changed -> whole repo` };
  if (touched.includes('package.json') && packageLintKeysChanged(cwd, base))
    return { scope: 'all', line: 'lint: package.json lint config changed -> whole repo' };
  const { eslint, prettier } = plan(changes.files);
  const n = new Set([...eslint, ...prettier]).size;
  return { scope: 'files', eslint, prettier, line: `lint: ${n} changed file${n === 1 ? '' : 's'}` };
}

function run(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1;
}

function main(ref) {
  const p = lintPlan(process.cwd(), ref);
  console.log(p.line);
  if (p.scope === 'all') return run('npm', ['run', '--silent', 'lint']);
  if (p.eslint.length && run('npx', ['eslint', '--concurrency=off', '--no-warn-ignored', ...p.eslint]) !== 0)
    return 1;
  if (p.prettier.length && run('npx', ['prettier', '--check', ...p.prettier]) !== 0) return 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv[2] ?? 'main'));
}
