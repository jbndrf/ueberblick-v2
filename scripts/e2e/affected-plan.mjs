// WP-1019: the plan `npm run e2e -- --affected <base>` follows: the selection (affected.mjs) cut to the 10 minute budget,
// and the verdict after the run (quarantine). Replay over the last land trains: affected-replay.mjs.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles } from '../ops/changed-select.mjs';
import { judge, loadQuarantine, validateQuarantine } from './affected-quarantine.mjs';
import { BUDGET_MS, fitBudget, itemsOf, selectAffected } from './affected.mjs';
import { hasFileFilters, loadHistory } from './shards.mjs';
import { summarizeReports } from './run-record.mjs';

/** Selection for the working tree against `base`, cut to the budget. `run` is `[{ suite, files|null }]`. */
export function planAffected(cwd, base, suites, historyOf, k) {
  const { files, deleted } = changedFiles(cwd, base);
  return finish(selectAffected(cwd, files, deleted, suites, { base, historyOf }), historyOf, k);
}

export function finish(sel, historyOf, k) {
  const fit = fitBudget(itemsOf(sel.suites, historyOf), k);
  const kept = (suite, file) => fit.run.some((i) => i.suite === suite && i.file === file);
  const run = sel.suites
    .map(({ suite, files }) => ({ suite, files: files ? files.filter((f) => kept(suite, f)) : files }))
    .filter((r) => (r.files ? r.files.length > 0 : kept(r.suite, null)));
  const lines = [...sel.lines];
  if (fit.run.length)
    lines.push(
      `e2e affected: ${fit.run.length} item(s), about ${(fit.estimateMs / 60_000).toFixed(1)} min on ${k} shard(s) by recorded duration`,
    );
  if (fit.skipped.length) {
    const names = fit.skipped.map((i) => `${i.suite.name}${i.file ? `/${i.file}` : ''}`);
    lines.push(
      `e2e affected: WARNING over the ${BUDGET_MS / 60_000} min budget: SKIPPED ${names.length} item(s), slowest kept first: ${names.join(', ')}`,
    );
  }
  return { run, lines, skipped: fit.skipped, estimateMs: fit.estimateMs };
}

/**
 * `--affected <base>` start: validates the quarantine, prints the plan (never silent about skipped specs), removes the old
 * reports and returns `{ affected: suite id -> spec files|null, selected: suites }`. Exits 0 when nothing is affected.
 */
export function startAffected(root, base, suites, historyPath, k) {
  const bad = validateQuarantine(loadQuarantine(root));
  if (bad.length > 0) throw new Error(`e2e: scripts/e2e/quarantine.json:\n${bad.join('\n')}`);
  const plan = planAffected(root, base, suites, (s) => loadHistory(historyPath(s, root)), k);
  plan.lines.forEach((l) => console.log(l));
  if (plan.run.length === 0) {
    console.log('e2e: --affected: nothing to run');
    process.exit(0);
  }
  plan.run.forEach(({ suite }) => rmSync(join(root, suite.report), { force: true })); // never judge an old report
  return {
    affected: new Map(plan.run.map((r) => [r.suite.id, r.files])),
    selected: plan.run.map((r) => r.suite),
  };
}

/**
 * After the run: judges the suites' reports against the quarantine. A red test the quarantine names does not refuse the
 * train; a stale entry is reported. Returns the run's `{ ok, failed, missing }`.
 */
export function judgeAffected(root, selected, missing, codes = new Map()) {
  const runs = selected.map((suite) => {
    try {
      return {
        suite,
        code: codes.get(suite.name),
        report: JSON.parse(readFileSync(join(root, suite.report), 'utf8')),
      };
    } catch {
      return { suite, code: codes.get(suite.name), report: null };
    }
  });
  const j = judge(runs, loadQuarantine(root), (f) => existsSync(join(root, f)));
  j.quarantined.forEach((q) => console.log(`e2e: quarantined, red and not refusing: ${q}`));
  j.stale.forEach((q) =>
    console.warn(`e2e: STALE quarantine entry (delete it from scripts/e2e/quarantine.json): ${q}`),
  );
  return { ok: j.failed.length === 0 && missing.length === 0, failed: j.failed, missing };
}

/** Test counts per file from `fileStats`, limited to the `only` files when given (`--affected`). */
export const testCounts = (stats, only) =>
  Object.fromEntries(
    Object.entries(stats)
      .filter(([f]) => !only || only.includes(f))
      .map(([f, s]) => [f, s.tests]),
  );

/**
 * A run with a file filter (`npm run e2e -- <path>`, no `--suite`). Playwright exits 1 with "No tests found" in every
 * suite that holds no matching file, so `args` adds `--pass-with-no-tests` (and removes the suites' old reports, so
 * `judge` reads only this run's); `judge` then fails the run only when no suite ran a test at all, so a mistyped path
 * still fails. Without a file filter both leave the run as it is.
 */
export const fileFilter = {
  args(root, suites, args) {
    if (!hasFileFilters(args)) return [];
    for (const s of suites) rmSync(join(root, s.report), { force: true });
    return ['--pass-with-no-tests'];
  },
  judge(result, root, suites, args, specs = () => summarizeReports(root, suites).specs) {
    if (!hasFileFilters(args) || specs() > 0) return result;
    return { ...result, ok: false, failed: [...result.failed, 'no test matched the file filter'] };
  },
};

/** Two `{ ok, failed, missing }` results as one (the pooled suites, then the ones that run alone). */
export function mergeResults(a, b) {
  return { ok: a.ok && b.ok, failed: [...a.failed, ...b.failed], missing: [...a.missing, ...b.missing] };
}
