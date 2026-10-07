#!/usr/bin/env node
// What the pre-commit hook runs (WP-953): the reference/ guard (R10), prettier --check and eslint on the
// STAGED files only, then glossary-lint (about 0.8 s) and ui-strings-lint (about 0.2 s), which scan the
// whole tree because they are cheap. No typecheck: it runs in `npm run check:changed` and in the train's
// full check. Usage: node scripts/ops/precommit.mjs [--files <path>...]   (default: the staged files)
// Also refuses staged text files with merge-conflict markers (WP-977: a failed resolution was committed twice).
// UEB_PRECOMMIT_SKIP_LINT=1 runs only the guards (specs).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The first staged path under reference/ (read-only, R10), or null. */
export function referenceViolation(files) {
  return files.find((f) => f.startsWith('reference/')) ?? null;
}

/**
 * The 1-based line of the first merge-conflict marker, or null. A marker is a line that starts with seven
 * `<` and a space (or is just those seven), or starts with seven `>` and a space. A line of seven `=` is
 * never a marker alone (setext headings), only the `<` line above it is, and that is found first.
 */
export function conflictMarkerLine(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (/^<{7}( |$)/.test(l)) return i + 1;
    if (/^>{7} /.test(l)) return i + 1;
  }
  return null;
}

/** First staged text file with a conflict marker as `file:line`, or null. `read` returns a file's text or null (binary). */
export function conflictViolation(files, read) {
  for (const f of files) {
    const text = read(f);
    if (text === null) continue;
    const line = conflictMarkerLine(text);
    if (line !== null) return `${f}:${line}`;
  }
  return null;
}

/** Files for prettier (same globs as `lint:prettier`) and eslint (code files under the same roots). */
export function plan(files) {
  const inRoots = (f) => /^(packages|apps|scripts)\//.test(f);
  const prettier = files.filter(
    (f) =>
      (/^(packages|apps)\/.+\.(ts|svelte|json)$/.test(f) ||
        /^scripts\/.+\.(mjs|ts)$/.test(f) ||
        /^[^/]+\.(json|js|cjs|ts)$/.test(f)) &&
      !f.startsWith('reference/'),
  );
  // .mts/.cts too: the full `eslint .` lints them (a .d.mts R6 error reached a land train unseen, WP-1020).
  const eslint = files.filter((f) => inRoots(f) && /\.(ts|mts|cts|svelte|mjs|js|cjs)$/.test(f));
  return { prettier, eslint };
}

function stagedFiles() {
  const r = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' });
  return r.stdout.split('\n').filter(Boolean);
}

/** The staged content of a file (the index), or null for binary or unreadable files. */
function stagedText(file) {
  const r = spawnSync('git', ['show', `:${file}`], { maxBuffer: 1 << 26 });
  return r.status === 0 && !r.stdout.includes(0) ? r.stdout.toString('utf8') : null;
}

function diskText(file) {
  try {
    const b = readFileSync(file);
    return b.includes(0) ? null : b.toString('utf8');
  } catch {
    return null;
  }
}

function step(name, cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`pre-commit: ${name} failed`);
    return false;
  }
  return true;
}

function main(argv) {
  const at = argv.indexOf('--files');
  const files = at >= 0 ? argv.slice(at + 1) : stagedFiles();
  const bad = referenceViolation(files);
  if (bad) {
    console.error(`pre-commit: reference/ is read-only (R10): ${bad}`);
    return 1;
  }
  const marked = conflictViolation(files, at >= 0 ? diskText : stagedText);
  if (marked) {
    console.error(`pre-commit: merge-conflict marker in staged file ${marked}`);
    return 1;
  }
  if (process.env.UEB_PRECOMMIT_SKIP_LINT) return 0;
  const p = plan(files);
  const ok =
    (p.prettier.length === 0 || step('prettier', 'npx', ['prettier', '--check', ...p.prettier])) &&
    (p.eslint.length === 0 ||
      step('eslint', 'npx', ['eslint', '--concurrency=off', '--no-warn-ignored', ...p.eslint])) &&
    step('glossary-lint', 'node', [resolve(here, '../glossary-lint.mjs')]) &&
    // Only the staged user docs: the hook is main's and runs in every worktree, so a rule added on main must not
    // fail an older worktree for a doc it did not touch (WP-977 did exactly that). check:fast still scans them all.
    (userDocs(files).length === 0 ||
      step('ui-strings-lint', 'node', [resolve(here, '../ui-strings-lint.mjs'), ...userDocs(files)]));
  return ok ? 0 : 1;
}

/** Staged docs/user Markdown files, the only ones the hook's ui-strings check reads. */
export const userDocs = (files) => files.filter((f) => f.startsWith('docs/user/') && f.endsWith('.md'));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
