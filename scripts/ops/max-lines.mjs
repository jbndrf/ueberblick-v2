#!/usr/bin/env node
// R8 for the source files ESLint's `max-lines` never sees (it does not lint .svelte): fails with one line per
// git-tracked file over 400 lines, `path: N lines (R8: max 400)`. The ignore list mirrors eslint.config.js
// (reference/, generated paraglide output, build dirs); .ts/.mjs files are already covered by ESLint.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_LINES = 400;
/** Extensions ESLint does not lint but that hold source. */
export const EXTENSIONS = ['.svelte'];
const IGNORED = [
  /^reference\//,
  /^\.claude\//,
  /(^|\/)paraglide\//,
  /(^|\/)(node_modules|dist|build|\.svelte-kit|\.svelte-check)\//,
  /^(docs|fixtures|spikes|schema|\.githooks)\//,
];

/** Whether `path` (repo-relative, forward slashes) is a checked source file. */
export function isChecked(path) {
  return EXTENSIONS.some((e) => path.endsWith(e)) && !IGNORED.some((re) => re.test(path));
}

/** Same count as ESLint's max-lines: lines in the file, a trailing newline does not add one. */
export function countLines(text) {
  if (text === '') return 0;
  return text.split(/\r\n|\r|\n/).length - (/(\r\n|\r|\n)$/.test(text) ? 1 : 0);
}

/** The violation lines for `paths`, reading each with `read(path)`. */
export function findViolations(paths, read) {
  const out = [];
  for (const path of paths.filter(isChecked)) {
    const n = countLines(read(path));
    if (n > MAX_LINES) out.push(`${path}: ${n} lines (R8: max ${MAX_LINES})`);
  }
  return out;
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const bad = findViolations(paths, (p) => {
    try {
      return readFileSync(`${root}/${p}`, 'utf8');
    } catch {
      return ''; // tracked but deleted in the working tree
    }
  });
  for (const line of bad) console.error(line);
  return bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
