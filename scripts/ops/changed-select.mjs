// WP-955/WP-991: which tests `npm run check:changed` runs. One decision per changed file, printed so a broad run
// explains itself:
//   - a blanket trigger (scripts/ops/rerun-triggers.mjs RERUN_TRIGGERS)  -> every test
//   - a package.json: only `scripts`/`description` changed against the merge-base -> its reader specs and the specs
//     naming a changed script; any other key, a new or unreadable file, no merge-base -> every test
//   - a file of a narrowed tree (SCAN_RULES: messages, docs/process, .claude/agents, CLAUDE.md, scripts, the budgets
//     doc, .dependency-cruiser.cjs, fixtures/golden, schema)
//     -> every spec whose text reads that tree by path (found by scanning, never listed), plus the import graph;
//        (WP-1010: also every non-spec module whose text reads the tree, e.g. a testkit loading it: a seed)
//        <pkg>/messages/** also the importers of that package's compiled Paraglide entry; scripts/** also every
//        spec naming the file; golden and schema files with no reader spec -> every test
//   - a deleted file that is no spec -> the specs that imported it at the merge-base (graph of that commit), plus
//     the narrowed-tree rules above; no merge-base or no graph -> every test
//   - a barrel that only gained named re-exports of new modules (WP-992, barrel-diff.mjs) -> nothing for the barrel
//     and nothing for the new modules (their users are in the diff); removals, re-points, `export *` -> the graph
//   - always (WP-1039, ALWAYS_SPECS): the whole-tree guard specs, whatever the diff, so their reds stop at the agent
//   - anything else                                                   -> the import graph of the file
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { isPlanted } from '../testing/plant.mjs';
import { additiveBarrel } from './barrel-diff.mjs';
import { buildGraphAt, specsFor } from './fanout-graph.mjs';
import {
  isVitestSpec,
  isRerunTrigger,
  messageEntries,
  PACKAGE_JSON_NARROW_KEYS,
  REPO_WALK,
  SCAN_RULES,
  stripComments,
} from './rerun-triggers.mjs';

/**
 * WP-1039: guard specs that walk the whole repository (planted files, spec environment, wall-clock asserts, e2e project
 * keys, icon imports, viewports, docsync, UI strings). A change rarely imports them, yet it can break them; they cost
 * seconds, so every check:changed runs them. A fixture repository without the file skips it.
 */
export const ALWAYS_SPECS = [
  'scripts/testing/plant.spec.ts',
  'scripts/testing/spec-env.spec.ts',
  'scripts/guardrails.spec.ts',
  'scripts/ops/e2e-project-keys.spec.ts',
  'scripts/ops/lucide-imports.spec.ts',
  'scripts/ops/e2e-viewports.spec.ts',
  'scripts/docsync/guardrails.spec.ts',
  'scripts/ui-strings-lint.spec.ts',
  'scripts/metrics/parity.spec.ts', // the evidence paths in metrics/parity/elements.json (refused WP-831)
  'scripts/ops/wp-ids.spec.ts', // one id per work package (WP-510..513 reused, 2026-10-05)
];

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .filter(Boolean);

/**
 * Changes since `base`: committed, staged, unstaged and untracked (what vitest's --changed lists), split into
 * `files` (added or modified) and `deleted`. A rename counts as the old path deleted plus the new path added
 * (`--no-renames`): the importers of a vanished path cannot be found by the import graph.
 */
export function changedFiles(cwd, base) {
  const files = new Set(git(cwd, 'ls-files', '--others', '--exclude-standard'));
  const deleted = [];
  for (const line of git(cwd, 'diff', '--name-status', '--no-renames', base)) {
    const [status, ...rest] = line.split('\t');
    if (status === 'D') deleted.push(rest.join('\t'));
    else files.add(rest.join('\t'));
  }
  return { files: [...files], deleted };
}

// A tracked spec removed or moved on disk without staging is still in `ls-files -c`: only specs on disk are scanned.
export const specFiles = (cwd) =>
  git(cwd, 'ls-files', '-co', '--exclude-standard', '*.spec.ts', '*.spec.mjs').filter(
    (s) => isVitestSpec(s) && existsSync(`${cwd}/${s}`),
  );

const MODULE_SCOPE = /^(packages\/(tools\/)?[^/]+|apps\/[^/]+)\/src\/|^scripts\//;

/**
 * WP-1010: non-spec source modules (helpers, testkits) that specs reach through the import graph. A spec that loads
 * a narrowed tree through such a helper never names the tree, so the helper's own text is scanned too.
 */
export const moduleFiles = (cwd) =>
  git(cwd, 'ls-files', '-co', '--exclude-standard', '*.ts', '*.mjs', '*.js', '*.svelte').filter(
    (f) =>
      MODULE_SCOPE.test(f) &&
      !f.includes('node_modules/') &&
      !/\.spec\.(ts|mjs)$/.test(f) &&
      !isPlanted(f) &&
      existsSync(`${cwd}/${f}`),
  );

const packageOf = (entries, file) =>
  Object.keys(entries).find(
    (p) => file.startsWith(`${p}/messages/`) || file.startsWith(`${p}/project.inlang/`),
  );

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Why a changed package.json must run every test, or the scripts that changed. `null` text is a file that does not
 * exist at that revision. `head` is a commit to read the new text from (default: the working tree).
 * @returns {{ all: string } | { scripts: string[] }}
 */
function packageJsonChange(cwd, file, { base, head }) {
  if (!base) return { all: 'no merge-base to compare against' };
  const show = (rev) => {
    try {
      return execFileSync('git', ['show', `${rev}:${file}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  };
  const was = parseJson(show(base) ?? 'null');
  const text = head
    ? show(head)
    : existsSync(`${cwd}/${file}`)
      ? readFileSync(`${cwd}/${file}`, 'utf8')
      : null;
  const now = parseJson(text ?? 'null');
  if (!was || !now) return { all: 'new, deleted or unreadable' };
  const rest = (j) =>
    JSON.stringify(Object.entries(j).filter(([k]) => !PACKAGE_JSON_NARROW_KEYS.includes(k)));
  if (rest(was) !== rest(now)) return { all: 'a key other than scripts/description changed' };
  const [a, b] = [was.scripts ?? {}, now.scripts ?? {}];
  return { scripts: [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]) };
}

/** A spec text that runs or names the script: `npm run [-s] name`, or the quoted name. */
const namesScript = (text, name) => {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`npm run( -\\w+)* ${n}(?![\\w:-])|['"\`]${n}['"\`]`).test(text);
};

/**
 * @param {string} cwd repository root
 * @param {string[]} files changed files, repository-relative
 * @param {string[]} [deleted] deleted paths. A deleted spec selects nothing. Any other deleted file selects the
 *   specs that imported it at `opts.base`; without a base, or when that graph cannot be built, every test.
 * @param {{ base?: string, head?: string }} [opts] `base`: the merge-base commit; `head`: the commit holding the
 *   new files (default: the working tree), for the replay of a recorded run
 * @returns {{ all: boolean, related: string[], lines: string[], messagePackages: string[] }}
 *   `related` are files for `vitest related`
 */
export function selectChanged(cwd, files, deleted = [], opts = {}) {
  const all = (line) => ({ all: true, related: [], lines: [line], messagePackages: [] });
  const gone = deleted.filter((f) => !isVitestSpec(f));
  const lines = [];
  const related = new Set();
  const texts = new Map(); // spec -> text, read once per run (a few hundred small files, tens of ms)
  const textOf = (s) =>
    texts.has(s) ? texts.get(s) : (texts.set(s, readFileSync(`${cwd}/${s}`, 'utf8')), texts.get(s));
  let specs = null;
  const allSpecs = () => (specs ??= specFiles(cwd));
  let modules = null;
  const allModules = () => (modules ??= moduleFiles(cwd));
  const messagePkgs = new Set();
  const entries = messageEntries(cwd);
  const hits = new Map(SCAN_RULES.map((r) => [r.name, { files: 0, specs: new Set(), modules: new Set() }]));
  const newModules = new Set();
  const scriptFiles = [];
  const changedScripts = new Set();
  const todo = [...files.map((f) => [f, false]), ...gone.map((f) => [f, true])];
  for (const [file, isGone] of todo) {
    if (isRerunTrigger(cwd, `${cwd}/${file}`)) return all(`trigger ${file} -> all tests`);
    const rules = SCAN_RULES.filter((r) => r.matches(file));
    if (rules.some((r) => r.name === 'package.json')) {
      const change = isGone ? { all: 'deleted' } : packageJsonChange(cwd, file, opts);
      if (change.all) return all(`trigger ${file} (${change.all}) -> all tests`);
      change.scripts.forEach((s) => changedScripts.add(s));
    }
    for (const r of rules) {
      const hit = hits.get(r.name);
      hit.files++;
      if (hit.files === 1)
        allSpecs()
          .filter((s) => r.reads.test(textOf(s)) || REPO_WALK.test(textOf(s)))
          .forEach((s) => hit.specs.add(s));
      if (hit.files === 1)
        (r.moduleReads ? allModules() : [])
          .filter((m) => r.moduleReads.test(stripComments(textOf(m))))
          .forEach((m) => hit.modules.add(m));
      if (!hit.specs.size && !hit.modules.size && r.noReader === 'all')
        return all(`trigger ${file} (no reader spec found for ${r.name}) -> all tests`);
    }
    if (rules.some((r) => r.name === 'messages')) {
      const pkg = packageOf(entries, file);
      if (!pkg) return all(`trigger ${file} (no compiled entry known) -> all tests`);
      messagePkgs.add(pkg);
      continue; // the catalogue is no module: its importers are found through the compiled entry
    }
    if (isGone) continue;
    const barrel = additiveBarrel(cwd, file, { ...opts, note: (t) => lines.push(t) });
    if (barrel) {
      lines.push(
        `check:changed barrel ${file}: ${barrel.added} added exports -> no importers (their users are in the diff)`,
      );
      barrel.targets.forEach((t) => newModules.add(t));
      continue;
    }
    related.add(file);
    if (file.startsWith('scripts/')) scriptFiles.push(file);
  }
  // A new module behind an additive barrel edit: vitest would reach the barrel's importers through it. Its own
  // importers are changed files (it did not exist), so they and their specs are selected on their own.
  newModules.forEach((t) => related.delete(t));
  for (const pkg of messagePkgs) related.add(entries[pkg]);
  if (scriptFiles.length) {
    const names = scriptFiles.map((f) => basename(f));
    const named = allSpecs().filter((s) => names.some((n) => textOf(s).includes(n)));
    named.forEach((s) => hits.get('scripts').specs.add(s));
    hits.get('scripts').naming = named.length;
  }
  if (changedScripts.size) {
    const named = allSpecs().filter((s) => [...changedScripts].some((n) => namesScript(textOf(s), n)));
    named.forEach((s) => hits.get('package.json').specs.add(s));
    hits.get('package.json').naming = named.length;
  }
  for (const [name, hit] of hits) {
    if (!hit.files) continue;
    hit.specs.forEach((s) => related.add(s));
    hit.modules.forEach((m) => related.add(m));
    const rule = SCAN_RULES.find((r) => r.name === name);
    const extra =
      name === 'scripts'
        ? ` (${hit.naming ?? 0} naming the files)`
        : name === 'package.json'
          ? ` (${hit.naming ?? 0} naming a changed script)`
          : (rule.note ?? '');
    const what = rule.label ?? `${hit.files} files`;
    const mods = hit.modules.size
      ? ` + ${hit.modules.size} reader modules (${[...hit.modules].slice(0, 3).join(', ')}${hit.modules.size > 3 ? ', …' : ''})`
      : '';
    lines.push(`${name}: ${what} -> ${hit.specs.size} reader specs${mods}${extra} + import graph`);
  }
  if (gone.length) {
    let importers;
    try {
      if (!opts.base) throw new Error('no merge-base');
      const { g } = buildGraphAt(cwd, opts.base);
      importers = specsFor(
        g,
        allSpecs().filter((s) => g.nodes.has(s)),
        gone,
      );
    } catch {
      return all(`deleted ${gone.join(', ')} -> all tests (no import graph at the merge-base)`);
    }
    importers.forEach((s) => related.add(s));
    lines.push(`deleted ${gone.join(', ')} -> ${importers.length} specs that imported it`);
  }
  ALWAYS_SPECS.filter((g) => existsSync(`${cwd}/${g}`)).forEach((g) => related.add(g));
  return { all: false, related: [...related], lines, messagePackages: [...messagePkgs] };
}
