// WP-935: files whose change makes `npm run check:changed` run every test. Tests read them by path, or
// they shape every run, so the import graph cannot see them. Too much is the safe error.
// Vitest matches its forceRerunTriggers with picomatch on absolute paths and without `dot: true`, so a
// leading `**` never crosses a dot directory. Agent worktrees live under `.claude/worktrees/`, so every
// pattern is anchored at the repository root instead.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import picomatch from 'picomatch';

export const RERUN_TRIGGERS = [
  '**/package-lock.json',
  // WP-1006: only the root config; `npm test` loads no other. bench/*/vitest.config.ts belong to bench:test.
  'vitest.config.*',
  '**/vite.config.*',
  '**/vitest.setup.ts',
  '**/vitest.global-setup.ts',
  '**/tsconfig*.json',
  '**/svelte.config.*',
  '.githooks/**',
  // scripts that vitest.config.ts itself imports: they shape every run
  'scripts/ops/rerun-triggers.mjs',
  'scripts/ops/resources.mjs',
  'scripts/ops/vitest-scoped.guard.mjs',
  'apps/web/playwright.config.ts',
];

/** The trigger patterns anchored at `root` (an absolute path without a trailing slash). */
export const rerunTriggers = (root) => RERUN_TRIGGERS.map((p) => `${root}/${p}`);

/** Whether a change to the absolute path `file` makes check:changed run everything (vitest's own matcher). */
export const isRerunTrigger = (root, file) => picomatch(rerunTriggers(root))(file);

// WP-955: trees whose change no longer reruns everything. The import graph cannot see a spec that reads them
// by path, so a change to one scans the specs' text for such a read (scripts/ops/changed-select.mjs) and selects
// every match: nothing to keep in sync by hand.

/** Where a package compiles its Paraglide output when its `i18n` script names no `--outdir`. */
const DEFAULT_OUTDIR = 'src/paraglide';
/** Directories whose children may be packages; a package is any directory with `project.inlang/` (WP-989). */
const PACKAGE_PARENTS = ['apps', 'packages', 'packages/tools'];

/** The npm script of a package that compiles its Paraglide output (the one with `--outdir`) and that outdir. */
const i18nOf = (dir) => {
  try {
    const scripts = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).scripts ?? {};
    for (const script of ['i18n:own', 'i18n']) {
      const m = /--outdir\s+(?:\.\/)?(\S+)/.exec(scripts[script] ?? '');
      if (m) return { script, outdir: m[1].replace(/\/$/, '') };
    }
  } catch {
    // no readable package.json: the default
  }
  return { script: 'i18n', outdir: DEFAULT_OUTDIR };
};

/** The npm script that compiles the package's messages (`npm run <script>` in the package directory). */
export const i18nScript = (root, pkg) => i18nOf(`${root}/${pkg}`).script;

/**
 * Compiled Paraglide entry per package that owns a `messages/` catalogue and `project.inlang/`, read from the
 * tree: a new tool package is covered without editing this file. The entry is the `--outdir` of the package's
 * `i18n` script plus `/messages.js`.
 */
export function messageEntries(root) {
  const entries = {};
  for (const parent of PACKAGE_PARENTS) {
    let names = [];
    try {
      names = readdirSync(`${root}/${parent}`, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue; // the parent does not exist in this tree
    }
    for (const { name } of names) {
      const pkg = `${parent}/${name}`;
      if (existsSync(`${root}/${pkg}/project.inlang`))
        entries[pkg] = `${pkg}/${i18nOf(`${root}/${pkg}`).outdir}/messages.js`;
    }
  }
  return entries;
}

/** A spec that walks the repository root or a whole top-level tree reads every narrowed tree. */
export const REPO_WALK = /walk\(\s*['"](\.|docs|scripts|\.claude[^'"]*)['"]\s*\)/;

/** Keys of a package.json whose change selects readers; a change to any other key (dependencies, exports, ...) runs every test. */
export const PACKAGE_JSON_NARROW_KEYS = ['scripts', 'description'];

/**
 * WP-1010: a regex for a non-spec module that really loads the tree `path` (a regex source): `import.meta.glob(`,
 * a read/join/resolve call or a `?raw` import naming it. Tested on comment-stripped text. Only the rules that
 * need a module scan (a testkit loading a data tree) set `moduleReads`; every other rule scans specs only.
 */
const loadsTree = (path) =>
  new RegExp(
    `import\\.meta\\.glob\\([^)]*${path}|(?:readFileSync|readdirSync|join|resolve)\\([^)]*['"\`/]${path}|${path}[^'"\`]*\\?raw`,
  );

/** Source text without `//` and block comments (a comment marker must follow whitespace: globs hold `/**` ). */
export const stripComments = (text) =>
  text.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|\s)\/\/.*$/gm, '$1');

/** Narrowed trees: `matches` says which changed files belong to it, `reads` finds the specs that read it by path. */
export const SCAN_RULES = [
  {
    name: 'messages',
    matches: (file) => /(^|\/)(messages|project\.inlang)\//.test(file),
    reads: /(^|[^\w.])messages\/(\$\{|de\b|en\b|\{|<)|\.\.\/messages|['"]messages['"]|project\.inlang/,
  },
  // WP-991: docs and config that tests read by path. `note` ends the selection line; `noReader: 'all'` runs every
  // test when the scan finds no reader (a data tree nobody names might be loaded some other way).
  {
    name: 'docs/12-performance-budgets.md',
    matches: (f) => f === 'docs/12-performance-budgets.md',
    reads: /12-performance-budgets/,
  },
  {
    name: '.dependency-cruiser.cjs',
    matches: (f) => f === '.dependency-cruiser.cjs',
    reads: /dependency-cruiser/,
    note: ' (the boundaries step of check:changed checks the config itself)',
  },
  // lint configs shape no test run: only specs that run eslint or prettier can see them, and lint:changed checks the whole
  // repo when one changes (LINT_CONFIGS in lint-changed.mjs)
  {
    name: 'lint config',
    matches: (f) => f === 'eslint.config.js' || /^\.prettier(rc[^/]*|ignore)$/.test(f),
    reads: /\beslint\b|\bprettier\b/,
    note: ' (lint:changed checks the whole repo for a lint config change)',
  },
  {
    name: 'fixtures/golden',
    matches: (f) => f.startsWith('fixtures/golden/'),
    reads: /fixtures\/golden/,
    moduleReads: loadsTree('fixtures\\/golden'),
    noReader: 'all',
  },
  {
    name: 'schema',
    matches: (f) => f.startsWith('schema/'),
    reads: /(^|[^\w.-])schema\/[\w.-]+|\.schema\.json/,
    moduleReads: loadsTree('schema\\/'),
    noReader: 'all',
  },
  // a package.json that changed only in `scripts` or `description` (decided in changed-select.mjs: any other key is
  // every test); its readers are the specs naming a package.json
  {
    name: 'package.json',
    matches: (f) => /(^|\/)package\.json$/.test(f),
    reads: /package\.json/,
    label: 'scripts only',
  },
  { name: 'docs/process', matches: (f) => f.startsWith('docs/process/'), reads: /docs\/process\// },
  { name: '.claude/agents', matches: (f) => f.startsWith('.claude/agents/'), reads: /\.claude\/agents/ },
  { name: 'CLAUDE.md', matches: (f) => f === 'CLAUDE.md', reads: /CLAUDE\.md/ },
  // specs that scan or stage the scripts tree; a spec naming the changed file is found separately
  { name: 'scripts', matches: (f) => f.startsWith('scripts/'), reads: /['"]scripts['"]/ },
];

/** The specs vitest runs (vitest.config.ts `include`); Playwright and bench specs are outside check:changed. */
export const isVitestSpec = (file) =>
  /^(packages\/.+\/src\/|apps\/[^/]+\/src\/|scripts\/|fixtures\/golden\/).*\.spec\.(ts|mjs)$/.test(file);
