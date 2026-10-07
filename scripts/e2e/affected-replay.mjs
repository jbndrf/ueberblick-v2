// WP-1019: replays the selection over the last land trains: `node scripts/e2e/affected-replay.mjs <n>` prints, per train,
// the changed files, the selected specs, the estimated minutes and what the budget would skip.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finish } from './affected-plan.mjs';
import { readTree, selectAffected } from './affected.mjs';

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 << 20 })
    .split('\n')
    .filter(Boolean);

/** The last `n` land trains on main's first-parent line: runs of merge commits made within 90 s of each other. */
export function lastTrains(cwd, n, ref = 'main') {
  const rows = git(cwd, 'log', '--first-parent', '--merges', '--format=%H %ct %P', ref).map((l) =>
    l.split(' '),
  );
  const trains = [];
  for (const [sha, ct, p1] of rows) {
    const cur = trains.at(-1);
    if (cur && cur.first - Number(ct) <= 90) Object.assign(cur, { first: Number(ct), base: p1 });
    else {
      if (trains.length === n) break;
      trains.push({ head: sha, first: Number(ct), base: p1 });
    }
  }
  return trains;
}

/** Replays the selection for the last `n` trains (`base` = the first merge's parent, tree = the last merge). */
export function replay(cwd, n, suites, historyOf, k) {
  return lastTrains(cwd, n).map((t) => {
    const names = git(cwd, 'diff', '--name-status', '--no-renames', t.base, t.head).map((l) => l.split('\t'));
    const files = names.filter(([st]) => st !== 'D').map(([, f]) => f);
    const deleted = names.filter(([st]) => st === 'D').map(([, f]) => f);
    const sel = selectAffected(cwd, files, deleted, suites, {
      tree: readTree(cwd, t.head),
      base: t.base,
      historyOf,
    });
    return { ...t, changed: files.length + deleted.length, ...finish(sel, historyOf, k) };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { allSuites, historyPath } = await import('./run.mjs');
  const { loadHistory, shardCount } = await import('./shards.mjs');
  const historyOf = (s) => loadHistory(historyPath(s, cwd));
  const trains = replay(cwd, Number(process.argv[2] ?? 10), allSuites(cwd), historyOf, shardCount());
  for (const t of trains) {
    const specs = t.run.reduce((c, r) => c + (r.files ? r.files.length : 0), 0);
    const comps = t.run.filter((r) => !r.files).length;
    console.log(
      `${t.head.slice(0, 9)} base ${t.base.slice(0, 9)}: ${t.changed} changed files -> ${specs} specs + ${comps} component suites, ~${(t.estimateMs / 60_000).toFixed(1)} min, skipped ${t.skipped.length}`,
    );
    for (const l of t.lines.filter((x) => x.includes('affected:') && !x.includes('about')))
      console.log(`    ${l}`);
  }
}
