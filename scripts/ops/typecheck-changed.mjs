#!/usr/bin/env node
// WP-1012: the typecheck of `npm run check:changed`. The full `npm run typecheck` runs five projects (root tsc, ui,
// builder, bench, web); this runs only the ones the change can reach: a project that contains a changed file, plus
// every project whose workspace package depends on the package of a changed file. The map is read from the tsconfigs
// (include/exclude) and from the workspaces (package.json dependencies plus the `@ueberblick/*` imports in their
// sources, since a package.json can lag behind its imports), never listed by hand. Anything it cannot place (a
// tsconfig or package.json change, an unknown code path, no merge-base) typechecks everything. `check:fast`, the full
// `check` and the land train keep the full typecheck, so a project the scope missed shows up there.
// Usage: node scripts/ops/typecheck-changed.mjs [ref=main]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from './changed-base.mjs';
import { changedFiles } from './changed-select.mjs';
import { isPlanted } from '../testing/plant.mjs';

/** The typechecked projects, in run order: the tsconfig that defines each one and the npm script that checks it. */
export const PROJECTS = [
  { name: 'root', tsconfig: 'tsconfig.json', script: 'typecheck:root' },
  { name: 'ui', tsconfig: 'packages/ui/tsconfig.json', script: 'typecheck:ui' },
  { name: 'builder', tsconfig: 'packages/builder/tsconfig.json', script: 'typecheck:builder' },
  { name: 'bench', tsconfig: 'bench/tsconfig.json', script: 'typecheck:bench' },
  { name: 'web', tsconfig: 'apps/web/tsconfig.json', script: 'typecheck:web' },
];

const CODE = /\.(ts|mts|cts|svelte)$/;
const CONFIG_FILE =
  /(^|\/)(tsconfig[^/]*\.json|package\.json|package-lock\.json|svelte\.config\.[cm]?js)$|^[^/]+\.d\.m?ts$/;

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/** A tsconfig glob (`**`, `*`, plain dir) as a regex over a repo-relative path; a dir pattern matches what is below it. */
function globRegex(glob) {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${body}(?:/.*)?$`);
}

const resolveGlob = (dir, g) => posix.normalize(posix.join(dir, g));

/** The include/exclude matcher of one tsconfig, or null when it cannot be read. */
function tsconfigMatcher(cwd, tsconfig) {
  const json = readJson(join(cwd, tsconfig));
  if (!json || !Array.isArray(json.include)) return null;
  const dir = posix.dirname(tsconfig);
  const inc = json.include.map((g) => globRegex(resolveGlob(dir, g)));
  const exc = (json.exclude ?? []).map((g) => globRegex(resolveGlob(dir, g)));
  return (file) => inc.some((r) => r.test(file)) && !exc.some((r) => r.test(file));
}

/** The workspace packages: `{ dir, name, deps }`, deps being the names this package depends on or imports. */
function workspaces(cwd) {
  const globs = readJson(join(cwd, 'package.json'))?.workspaces ?? [];
  const dirs = [];
  for (const g of globs) {
    if (!g.endsWith('/*')) continue;
    const base = g.slice(0, -2);
    if (!existsSync(join(cwd, base))) continue;
    for (const e of readdirSync(join(cwd, base), { withFileTypes: true }))
      if (e.isDirectory() && existsSync(join(cwd, base, e.name, 'package.json')))
        dirs.push(`${base}/${e.name}`);
  }
  const pkgs = dirs.map((dir) => {
    const json = readJson(join(cwd, dir, 'package.json')) ?? {};
    return { dir, name: json.name, json, deps: new Set() };
  });
  const names = new Set(pkgs.map((p) => p.name));
  for (const p of pkgs) {
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies'])
      for (const d of Object.keys(p.json[k] ?? {})) if (names.has(d)) p.deps.add(d);
    for (const f of sourceFiles(cwd, p.dir))
      for (const m of readFileSync(join(cwd, f), 'utf8').matchAll(/['"](@ueberblick\/[a-z-]+)/g))
        if (names.has(m[1]) && m[1] !== p.name) p.deps.add(m[1]);
  }
  return pkgs;
}

/** Tracked and untracked source files below `dir` (git knows which are ignored: generated dirs, node_modules). */
function sourceFiles(cwd, dir) {
  return (
    execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', dir], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 << 20,
    })
      .split('\n')
      // Plants (scripts/testing/plant.mjs) are temporary guard-spec files that may import across packages on purpose.
      .filter((f) => /\.(ts|svelte|js|mjs)$/.test(f) && !isPlanted(f) && existsSync(join(cwd, f)))
  );
}

/** Does `pkg` reach `target` through dependencies (or is it `target`)? */
function reaches(byName, pkg, target, seen = new Set()) {
  if (pkg.name === target) return true;
  if (seen.has(pkg.name)) return false;
  seen.add(pkg.name);
  return [...pkg.deps].some((d) => byName.get(d) && reaches(byName, byName.get(d), target, seen));
}

const all = (why) => ({ all: true, projects: PROJECTS.map((p) => p.name), line: `typecheck: all (${why})` });

/**
 * Which projects to typecheck for these changes. `{ all, projects, line }`: `projects` are names from PROJECTS, in
 * run order; `line` says what was chosen and why.
 */
export function selectTypecheck(cwd, files, deleted = []) {
  const changed = [...files, ...deleted];
  const hit = changed.find((f) => CONFIG_FILE.test(f));
  if (hit) return all(`${hit} changed`);
  const known = new Set(PROJECTS.map((p) => p.tsconfig));
  const stray = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*tsconfig*.json'], {
    cwd,
    encoding: 'utf8',
  })
    .split('\n')
    .find((f) => f && !f.startsWith('reference/') && !f.includes('node_modules') && !known.has(f));
  if (stray) return all(`unknown project ${stray}`);
  const matchers = PROJECTS.map((p) => tsconfigMatcher(cwd, p.tsconfig));
  const unreadable = PROJECTS.find((_, i) => !matchers[i]);
  if (unreadable) return all(`${unreadable.tsconfig} unreadable`);
  const pkgs = workspaces(cwd);
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  // A project with a package.json of its own reaches what that package depends on; bench (no package) sees every
  // library workspace under packages/.
  const projectPkg = PROJECTS.map((p) => pkgs.find((w) => w.dir === posix.dirname(p.tsconfig)));
  const picked = new Set();
  const dirs = new Set();
  for (const f of changed) {
    const ws = pkgs.filter((w) => f.startsWith(`${w.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
    const direct = PROJECTS.flatMap((_, i) => (matchers[i](f) ? [i] : []));
    if (!CODE.test(f) && !direct.length) continue;
    if (!direct.length && !ws && CODE.test(f)) return all(`unknown path ${f}`);
    if (!direct.length && CODE.test(f)) return all(`${f} is in no project`);
    for (const i of direct) picked.add(i);
    if (ws)
      PROJECTS.forEach((p, i) => {
        const own = projectPkg[i];
        if (own ? reaches(byName, own, ws.name) : ws.dir.startsWith('packages/') && p.name === 'bench')
          picked.add(i);
      });
    dirs.add(ws ? ws.dir : f.split('/')[0]);
  }
  const projects = PROJECTS.filter((_, i) => picked.has(i)).map((p) => p.name);
  if (projects.length === 0)
    return { all: false, projects, line: 'typecheck: none (no typechecked file changed)' };
  return {
    all: false,
    projects,
    line: `typecheck: ${projects.join(', ')} (${[...dirs].join(', ')} changed)`,
  };
}

function main(ref) {
  const cwd = process.cwd();
  let sel;
  try {
    const { files, deleted } = changedFiles(cwd, mergeBase(cwd, ref));
    sel = selectTypecheck(cwd, files, deleted);
  } catch {
    sel = all(`no merge-base with ${ref}`);
  }
  console.log(sel.line);
  if (sel.projects.length === 0) return 0;
  const scripts = sel.projects.map((n) => PROJECTS.find((p) => p.name === n).script);
  const args = sel.all
    ? ['run', '--silent', 'typecheck']
    : ['scripts/ops/steps.mjs', '--parallel', '--before', 'typecheck:gen', 'typecheck', ...scripts];
  const r = spawnSync(sel.all ? 'npm' : 'node', args, { cwd, stdio: 'inherit' });
  return r.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv[2] ?? 'main'));
}
