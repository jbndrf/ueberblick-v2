// WP-1019: which e2e specs a land train's changes can affect (`npm run e2e -- --affected <base>`), like check:changed
// does for vitest. The import graph is scripts/ops/fanout-graph.mjs (R1: one resolver). e2e specs drive the built app,
// so two links join a changed file to a spec:
//   1. the spec's own import closure (its helpers, seeds, packages it imports) reaches the file;
//   2. a changed app file reaches a route (the route's +page/+layout/+server files, their ancestors' layouts and the
//      hooks, through the graph), and the spec visits that route: a string literal path in the spec or its helpers
//      (`/admin/projects/${key}/data`), or a `// e2e-covers: /admin/projects/[key]/data` header line in the spec.
// A spec that visits no route we can read ("unknown coverage") runs on any app change. A change to a suite's config
// or its support dir selects the whole suite; an app-wide change (lockfile, dependency keys, vite/svelte config,
// css, static assets, a deleted app file) selects every route. Anything else (docs, scripts, work) selects nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { buildGraph, specsFor } from '../ops/fanout-graph.mjs';
import { PACKAGE_JSON_NARROW_KEYS, messageEntries } from '../ops/rerun-triggers.mjs';

const ROUTES = 'apps/web/src/routes/';
const GRAPH_OPTS = { barrels: 'all', eraseTypes: true };
const APP_SRC = /^(apps\/web\/(src|static)\/|packages\/(tools\/)?[^/]+\/(src|messages|project\.inlang)\/)/;
const APP_WIDE = /^(package-lock\.json|apps\/web\/(vite|svelte)\.config\.[\w.]+|apps\/web\/static\/)/;
/** Runner files: a change to how e2e runs selects every fixed suite (reported, never silent). */
/**
 * Engine packages: unit-tested logic every route loads. A change there reaches a spec only through the spec's own imports
 * and the smoke spec per suite, not through every route that loads the package (that would select the whole suite).
 */
const ENGINE = /^packages\/(core|server|client)\//;
const RUNNER = /^scripts\/e2e\/(run|shards|component-config|discover)\.mjs$/;
export const BUDGET_MS = 10 * 60_000;

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 << 20 })
    .split('\n')
    .filter(Boolean);

/** The files of the tree at `rev` (null: the working tree) and a reader for their text. */
export function readTree(cwd, rev = null) {
  if (!rev)
    return {
      files: git(cwd, 'ls-files', '-co', '--exclude-standard').filter((f) => existsSync(`${cwd}/${f}`)),
      read: (f) => (existsSync(`${cwd}/${f}`) ? readFileSync(`${cwd}/${f}`, 'utf8') : ''),
    };
  const files = git(cwd, 'ls-tree', '-r', '--name-only', rev);
  const want = files.filter(
    (f) => /\.(ts|svelte|js|mjs|json|ya?ml|css)$/.test(f) && !f.startsWith('reference/'),
  );
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd,
    input: want.map((f) => `${rev}:${f}\n`).join(''),
    maxBuffer: 1 << 30,
  });
  const texts = new Map();
  let at = 0;
  for (const f of want) {
    const nl = out.indexOf(10, at);
    const size = Number(out.subarray(at, nl).toString('utf8').split(' ')[2]);
    texts.set(f, out.subarray(nl + 1, nl + 1 + size).toString('utf8'));
    at = nl + 1 + size + 1;
  }
  return { files, read: (f) => texts.get(f) ?? '' };
}

/** Where the specs of each fixed suite live (what Playwright reports file names against) and which files are specs. */
const FIXED = {
  'apps-web': { root: 'apps/web/e2e', specs: /^apps\/web\/e2e\/(?!candidates\/).+\.spec\.ts$/ },
  a11y: { root: 'e2e/a11y', specs: /^e2e\/a11y\/[^/]+\.spec\.ts$/ },
  participant: { root: 'e2e/participant', specs: /^e2e\/participant\/.+\.spec\.ts$/ },
  journeys: { root: 'e2e/journeys', specs: /^e2e\/journeys\/[^/]+\.spec\.ts$/ },
};
export const rootOf = (suite) => FIXED[suite.id]?.root ?? posix.dirname(suite.config);
const isComponent = (suite) => suite.id.startsWith('comp:');

// --- routes and the paths a spec visits ----------------------------------------------------------------------------
const segmentsOf = (path) => path.split('/').filter(Boolean);
const wild = (s) => /^\[.*\]$/.test(s) || s.includes('${');
/** A route directory under apps/web/src/routes as URL segments: (groups) dropped, [params] kept. */
const routeSegments = (dir) => segmentsOf(dir).filter((s) => !/^\(.*\)$/.test(s));

/**
 * Whether a visited path reaches the route. A literal names a page exactly, except that one ending in `/` (`open`) or
 * five or more segments deep also covers the pages below it: a spec that opens a feature clicks through to its
 * run page. A `[...rest]` route takes any longer path.
 */
export function visits(route, lit) {
  const rest = route.findIndex((s) => /^\[\[?\.\.\./.test(s));
  const r = rest < 0 ? route : route.slice(0, rest);
  const below = lit.open || lit.segs.length >= 5;
  if (lit.segs.length > r.length && rest < 0) return false;
  if (!below && rest < 0 && lit.segs.length !== r.length) return false;
  return lit.segs.every((s, i) => i >= r.length || wild(r[i]) || wild(s) || r[i] === s);
}

/** The route paths a text names: string literals that start with `/` (query dropped) and `e2e-covers:` header lines. */
export function pathsIn(text) {
  const lits = [];
  const add = (p, open = false) => lits.push({ segs: segmentsOf(p), open: open || p.endsWith('/') });
  for (const m of text.matchAll(/(['"`])(\/[\w\-.~%[\]$:{}/]*)/g)) {
    const p = m[2];
    if (p === '/' || /\.(ts|js|json|png|svg|css|map)$/.test(p) || p.startsWith('/tmp/')) continue;
    add(p);
  }
  for (const m of text.matchAll(/^\/\/ e2e-covers:\s*(.+)$/gm))
    for (const p of m[1].split(/[,\s]+/)) if (p) add(p);
  return lits;
}

const routeSegs = (url) => segmentsOf(url);

/**
 * The routes of the app (URL, and the files that render it: its own +files and the +layout files between it and the
 * root) and the `shared` entries every route runs through (hooks, the root layout).
 */
export function routesOf(g) {
  const dirs = new Map();
  for (const f of g.nodes.keys()) {
    if (!f.startsWith(ROUTES) || !/\/\+[^/]+\.(ts|svelte)$/.test(f)) continue;
    const dir = posix.dirname(f).slice(ROUTES.length).replace(/\/$/, '');
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push(f);
  }
  const layouts = (dir) => (dirs.get(dir) ?? []).filter((f) => /\/\+layout\./.test(f));
  const shared = [
    ...['apps/web/src/hooks.server.ts', 'apps/web/src/hooks.client.ts'].filter((f) => g.nodes.has(f)),
    ...layouts(''),
  ];
  const routes = [];
  for (const [dir, own] of dirs) {
    if (!own.some((f) => /\/\+(page|server)\./.test(f))) continue; // a layout alone serves no URL
    const parts = dir.split('/').filter(Boolean);
    const entries = new Set(own);
    for (let i = 1; i < parts.length; i++)
      layouts(parts.slice(0, i).join('/')).forEach((l) => entries.add(l));
    routes.push({ url: `/${routeSegments(dir).join('/')}`, entries: [...entries] });
  }
  return { routes, shared };
}

/**
 * The paths each spec visits: its own literals, plus those of the e2e helpers it imports (graph walk limited to the
 * suite's dir) unless more than half of the suite's specs reach the same path through helpers (the sign-in page every
 * spec passes through says nothing about what the spec is for).
 */
export function visitedBy(g, read, specs, root) {
  const key = (l) => `${l.segs.join('/')}${l.open ? '/' : ''}`;
  const mine = new Map();
  for (const spec of specs) {
    const seen = new Set([spec]);
    const todo = [...(g.nodes.get(spec)?.imports ?? []), ...(g.nodes.get(spec)?.reexports ?? [])].map(
      (e) => e.to,
    );
    let help = '';
    while (todo.length) {
      const f = todo.pop();
      if (!f.startsWith(`${root}/`) || seen.has(f)) continue;
      seen.add(f);
      help += `\n${read(f)}`;
      const n = g.nodes.get(f);
      for (const e of [...(n?.imports ?? []), ...(n?.reexports ?? [])]) todo.push(e.to);
    }
    mine.set(spec, { own: pathsIn(read(spec)), help: pathsIn(help) });
  }
  const count = new Map();
  for (const { help } of mine.values())
    for (const k of new Set(help.map(key))) count.set(k, (count.get(k) ?? 0) + 1);
  const out = new Map();
  for (const [spec, { own, help }] of mine)
    out.set(spec, [...own, ...help.filter((l) => (count.get(key(l)) ?? 0) * 2 <= specs.length)]);
  return out;
}

// --- package.json: only a change outside scripts/description is a dependency change ---------------------------------
function narrowPackageJson(cwd, file, base) {
  try {
    const was = JSON.parse(execFileSync('git', ['show', `${base}:${file}`], { cwd, encoding: 'utf8' }));
    const now = JSON.parse(readFileSync(`${cwd}/${file}`, 'utf8'));
    const rest = (j) =>
      JSON.stringify(Object.entries(j).filter(([k]) => !PACKAGE_JSON_NARROW_KEYS.includes(k)));
    return rest(was) === rest(now);
  } catch {
    return false;
  }
}

const graphOf = (cwd, tree) => {
  const inGraph = (f) =>
    (/\.(ts|svelte|js|mjs)$/.test(f) ||
      /^(schema|fixtures\/golden)\/.*\.(json|ya?ml)$/.test(f) ||
      f.endsWith('/package.json')) &&
    !f.startsWith('reference/');
  return buildGraph(
    cwd,
    [...new Set([...tree.files.filter(inGraph), ...Object.values(messageEntries(cwd))])],
    tree.read,
  );
};

/** The routes a list of changed files reaches, and the first file that reaches the shared code (hooks, root layout). */
function reach(g, changed) {
  const { routes, shared } = routesOf(g);
  const all = [...new Set([...routes.flatMap((r) => r.entries), ...shared])];
  const via = new Map(); // route url -> the changed file that reaches it
  let sharedHit = null;
  for (const f of changed) {
    const hit = new Set(specsFor(g, all, [f], GRAPH_OPTS));
    if (shared.some((e) => hit.has(e))) sharedHit ??= f;
    for (const r of routes) if (!via.has(r.url) && r.entries.some((e) => hit.has(e))) via.set(r.url, f);
  }
  return { routes, via, sharedHit };
}

/**
 * The selection for changed `files` (and `deleted`) of the tree `tree` (`readTree`); `base` is the commit the files
 * changed against (to read a deleted file's importers and a package.json's old keys), `historyOf(suite)` the recorded
 * durations (picks the smoke spec).
 * @returns {{ suites: { suite, files: string[]|null, why: Record<string,string> }[], lines: string[] }}
 *   `files` are spec paths relative to the suite's root; null = the whole suite (component suites).
 */
export function selectAffected(
  cwd,
  files,
  deleted,
  suites,
  { tree = readTree(cwd), base = null, historyOf = () => ({}) } = {},
) {
  const g = graphOf(cwd, tree);
  const entries = messageEntries(cwd);
  let appWide = null; // the reason an app-wide change was made, or null
  const changed = [];
  const wholeSuite = new Map(); // suite id -> reason
  const everySuite = (why) => suites.filter((s) => !isComponent(s)).forEach((s) => wholeSuite.set(s.id, why));
  for (const f of files) {
    const suite = suites.find((s) => f === s.config || f.startsWith(`${rootOf(s)}/`));
    if (suite) {
      if (f === suite.config || f.slice(rootOf(suite).length + 1).startsWith('support/'))
        wholeSuite.set(suite.id, `${f} is the suite's config or support`);
      else changed.push(f);
    } else if (RUNNER.test(f)) everySuite(`${f} changes how e2e runs`);
    else if (APP_WIDE.test(f)) appWide ??= `${f} is app-wide`;
    else if (f.endsWith('package.json') && /^(package\.json|apps\/|packages\/)/.test(f)) {
      if (!base || !narrowPackageJson(cwd, f, base)) appWide ??= `${f} changed beyond scripts`;
    } else if (APP_SRC.test(f)) {
      const msg = Object.entries(entries).find(
        ([p]) => f.startsWith(`${p}/messages/`) || f.startsWith(`${p}/project.inlang/`),
      );
      if (msg) changed.push(msg[1]);
      else if (g.nodes.has(f)) changed.push(f);
      else appWide ??= `${f} is an app asset the import graph cannot follow`;
    } else if (g.nodes.has(f) || /^(schema|fixtures\/golden)\//.test(f)) changed.push(f);
  }
  const lines = [];
  const isEngine = (f) => ENGINE.test(f);
  const now = reach(g, appWide ? [] : changed.filter((f) => !isEngine(f)));
  const engineHit = [...changed, ...deleted].find(isEngine) ?? null;
  const goneApp = deleted.filter((f) => APP_SRC.test(f) && !isEngine(f) && !/\.spec\.ts$/.test(f));
  let gone = { via: new Map(), sharedHit: null };
  if (goneApp.length && !base) appWide ??= `${goneApp[0]} was deleted`;
  else if (goneApp.length) gone = reach(graphOf(cwd, readTree(cwd, base)), goneApp);
  const via = new Map([...gone.via, ...now.via]);
  if (appWide) {
    lines.push(`e2e affected: ${appWide} -> every route`);
    now.routes.forEach((r) => via.set(r.url, appWide));
  }
  const sharedHit = now.sharedHit ?? gone.sharedHit ?? engineHit;
  const appChanged = via.size > 0 || sharedHit !== null;
  const selection = [];
  for (const suite of suites) {
    const root = rootOf(suite);
    const mine = tree.files.filter((f) => f.startsWith(`${root}/`));
    if (isComponent(suite)) {
      const own = changed.find((f) => f.startsWith(`${root}/`));
      const reachedBy = (f) =>
        specsFor(
          g,
          mine.filter((m) => g.nodes.has(m)),
          [f],
          GRAPH_OPTS,
        ).length > 0;
      const why =
        wholeSuite.get(suite.id) ??
        (own ? `${own} changed` : null) ??
        (changed.find(reachedBy) ? `${changed.find(reachedBy)} reaches the harness` : appWide);
      if (why) selection.push({ suite, files: null, why: { '*': why } });
      continue;
    }
    const specs = mine.filter((f) => FIXED[suite.id].specs.test(f));
    const reached = new Map();
    for (const f of changed)
      for (const s of specsFor(g, specs, [f], GRAPH_OPTS)) reached.set(s, `imports ${f}`);
    const h = historyOf(suite);
    const smoke = [...specs].sort(
      (a, b) => (h[a.slice(root.length + 1)] ?? 0) - (h[b.slice(root.length + 1)] ?? 0),
    )[0];
    const chosen = {};
    const visited = visitedBy(g, tree.read, specs, root);
    for (const spec of specs) {
      const lits = visited.get(spec);
      const hit = [...via].find(([url]) => lits.some((l) => visits(routeSegs(url), l)));
      const why =
        wholeSuite.get(suite.id) ??
        (changed.includes(spec) ? 'changed itself' : null) ??
        reached.get(spec) ??
        (hit ? `visits ${hit[0]} (${hit[1]})` : null) ??
        (lits.length === 0 && appChanged ? 'no readable route: runs on any app change' : null) ??
        (spec === smoke && sharedHit ? `smoke: ${sharedHit} reaches the shared app code` : null);
      if (why) chosen[spec.slice(root.length + 1)] = why;
    }
    if (Object.keys(chosen).length) selection.push({ suite, files: Object.keys(chosen).sort(), why: chosen });
  }
  for (const { suite, files: fs, why } of selection) {
    const sample = fs
      ? fs
          .slice(0, 3)
          .map((f) => `${f} (${why[f]})`)
          .join('; ')
      : why['*'];
    lines.push(
      `e2e affected: ${suite.name}: ${fs ? `${fs.length} spec(s): ${sample}${fs.length > 3 ? '; ...' : ''}` : `whole suite (${sample})`}`,
    );
  }
  if (selection.length === 0) lines.push('e2e affected: no spec is affected by these changes');
  return { suites: selection, lines };
}

// --- the 10 minute budget --------------------------------------------------------------------------------------------
/**
 * Items `{ suite, file|null, ms }` run slowest first until `budgetMs` of work per shard process is used; the rest is
 * skipped and returned (never silent: the caller prints and warns). Wall time ~ total ms / `k`.
 */
export function fitBudget(items, k, budgetMs = BUDGET_MS) {
  const run = [];
  const skipped = [];
  let total = 0;
  for (const it of [...items].sort((a, b) => b.ms - a.ms)) {
    if ((total + it.ms) / k > budgetMs) skipped.push(it);
    else {
      run.push(it);
      total += it.ms;
    }
  }
  return { run, skipped, estimateMs: total / k };
}

/** Items of a selection with their recorded durations (a file with no history weighs the suite's mean file). */
export function itemsOf(selection, historyOf) {
  return selection.flatMap(({ suite, files }) => {
    const h = historyOf(suite);
    const known = Object.values(h);
    const mean = known.length ? known.reduce((n, ms) => n + ms, 0) / known.length : 30_000;
    if (!files)
      return [{ suite, file: null, ms: known.length ? known.reduce((n, ms) => n + ms, 0) : 120_000 }];
    return files.map((file) => ({ suite, file, ms: h[file] ?? mean }));
  });
}
