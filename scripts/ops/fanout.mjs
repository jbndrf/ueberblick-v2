// WP-990: how many specs does `vitest related` select for a changed file? Builds the spec -> module import graph
// once from the text of the files (static and dynamic imports, re-exports; package `exports`, `$lib`, .svelte), the
// way vite's module graph links them, and answers "which specs reach this file".
//   npm run -s test:fanout                       top hubs: fan-out, churn on wp/* merges (7 days), cost
//   npm run -s test:fanout -- --files a.ts b.ts  specs a change to these files selects (check:changed rules)
//   npm run -s test:fanout -- --branch <sha>     the same for a branch's diff against main
//   npm run -s test:fanout -- --replay 100       the last scoped runs of tests.jsonl, per option
// Options modelled (docs/research/test-fanout.md): barrels 'ui-root' = subpath imports instead of the ui root
// barrel; 'all' = follow only the re-exports a spec imports; eraseTypes = inline `{ type X }` imports dropped.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { selectChanged, specFiles } from './changed-select.mjs';
import { buildGraph, codeFiles, fanoutPerFile, specsFor } from './fanout-graph.mjs';

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 << 20 })
    .split('\n')
    .filter(Boolean);

/** file -> number of wp/* merges in the last `days` days that changed it. */
export function churn(cwd, days = 7) {
  const out = new Map();
  let wp = false;
  const lines = git(
    cwd,
    'log',
    '--first-parent',
    '-m',
    `--since=${days} days ago`,
    '--name-only',
    '--format=@@%s',
  );
  for (const l of lines) {
    if (l.startsWith('@@')) wp = /wp\//.test(l);
    else if (wp) out.set(l, (out.get(l) ?? 0) + 1);
  }
  return out;
}

/** What check:changed would run for these changes: all specs, or the related ones (+ reader specs). */
export function predict(cwd, g, specs, files, deleted, opts = {}, base, head) {
  const sel = selectChanged(cwd, files, deleted, { base, head });
  if (sel.all) return { all: true, specs, line: sel.lines[0] };
  const pure = (n) => n.reexports.length > 0 && n.own.size === 0 && n.imports.length === 0;
  const live = sel.related.filter((f) => g.nodes.has(f) && !(opts.additiveBarrels && pure(g.nodes.get(f))));
  return { all: false, specs: specsFor(g, specs, live, opts), line: `${sel.lines.join('; ')}` };
}

/**
 * A branch's diff against the main it was cut from. With `at` (the time of a recorded run) main is taken as it
 * stood then, so a branch that has landed since still shows its own changes and not main's.
 */
export function branchChanges(cwd, ref, base = 'main', at) {
  const main = at ? (git(cwd, 'rev-list', '-1', '--first-parent', `--before=${at}`, base)[0] ?? base) : base;
  const b = git(cwd, 'merge-base', main, ref)[0];
  const files = [];
  const deleted = [];
  for (const line of git(cwd, 'diff', '--name-status', '--no-renames', b, ref)) {
    const [st, ...rest] = line.split('\t');
    (st === 'D' ? deleted : files).push(rest.join('\t'));
  }
  return { files, deleted, base: b };
}

const MODES = [
  ['base', {}],
  ['a', { barrels: 'ui-root' }],
  ['b', { barrels: 'all' }],
  ['c', { barrels: 'all', eraseTypes: true }],
  // upper bound: a changed file that only re-exports is taken to add exports, which nothing imports yet
  ['d', { barrels: 'all', eraseTypes: true, additiveBarrels: true }],
];

/** The last `n` scoped runs of tests.jsonl: actual files, and the files each option would have selected. */
export function replay(cwd, g, specs, n, tests, since) {
  const path = tests ?? '/home/jan/ueberblick-v4/metrics/raw/tests.jsonl';
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.kind === 'scoped' && /^wp\//.test(r.branch ?? '') && r.files > 0 && !r.crashed)
    .filter((r) => !since || r.at >= since)
    .slice(-n);
  const out = [];
  for (const r of rows) {
    try {
      git(cwd, 'cat-file', '-e', `${r.sha}^{commit}`);
    } catch {
      continue;
    }
    const ch = branchChanges(cwd, r.sha, 'main', r.at);
    const per = Object.fromEntries(
      MODES.map(([k, o]) => [
        k,
        predict(cwd, g, specs, ch.files, ch.deleted, o, ch.base, r.sha).specs.length,
      ]),
    );
    out.push({
      branch: r.branch,
      sha: r.sha,
      at: r.at,
      actual: r.files,
      wallMs: r.wallMs,
      changed: ch.files.length,
      ...per,
    });
  }
  console.log(JSON.stringify(out));
}

function main(argv) {
  const cwd = process.cwd();
  const t0 = Date.now();
  const files = codeFiles(cwd);
  const specs = specFiles(cwd);
  const g = buildGraph(cwd, files);
  const buildMs = Date.now() - t0;
  const at = (flag) => argv.indexOf(flag);
  const rest = (flag) =>
    argv.slice(at(flag) + 1).filter((a, i, all) => !all.slice(0, i + 1).some((x) => x.startsWith('--')));
  if (at('--replay') >= 0)
    return replay(
      cwd,
      g,
      specs,
      Number(argv[at('--replay') + 1] ?? 100),
      at('--tests') >= 0 ? argv[at('--tests') + 1] : undefined,
      at('--since') >= 0 ? argv[at('--since') + 1] : undefined,
    );
  if (at('--files') >= 0 || at('--branch') >= 0) {
    const ch =
      at('--branch') >= 0
        ? branchChanges(cwd, argv[at('--branch') + 1])
        : { files: rest('--files'), deleted: [] };
    const p = predict(
      cwd,
      g,
      specs,
      ch.files,
      ch.deleted,
      {},
      ch.base,
      at('--branch') >= 0 ? argv[at('--branch') + 1] : undefined,
    );
    if (argv.includes('--list')) console.log(ch.files.join('\n'));
    console.log(`${p.specs.length} of ${specs.length} specs${p.all ? ' (all tests)' : ''}: ${p.line}`);
    return;
  }
  const top = Number(argv[at('--top') + 1] ?? 40);
  const fan = fanoutPerFile(g, specs);
  const ch = churn(cwd);
  const rows = [...fan]
    .filter(([f]) => !specs.includes(f))
    .map(([f, n]) => ({ f, n, c: ch.get(f) ?? 0, cost: n * (ch.get(f) ?? 0) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, top);
  console.log(`graph: ${g.nodes.size} modules, ${specs.length} specs, built in ${buildMs} ms`);
  console.log('fan-out  churn7d  cost    file');
  for (const r of rows)
    console.log(
      `${String(r.n).padStart(7)}  ${String(r.c).padStart(7)}  ${String(r.cost).padStart(6)}  ${r.f}`,
    );
  const byCost = [...rows].sort((a, b) => b.cost - a.cost).slice(0, 10);
  console.log('\nby cost (fan-out x churn):');
  for (const r of byCost) console.log(`${String(r.cost).padStart(6)}  ${r.n} x ${r.c}  ${r.f}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
