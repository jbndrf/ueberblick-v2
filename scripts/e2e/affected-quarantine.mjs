// WP-1019: the e2e quarantine, the named, dated list of specs that are red on main at workers=1 and do not refuse a train
// (scripts/e2e/quarantine.json; each entry: suite, file, line, lane that fixes it, since, note). It only shrinks:
// `judge` reports an entry whose spec ran green or whose file is gone as stale, and a lane deletes it.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { rootOf } from './affected.mjs';

export const LANES = ['lead-a', 'lead-b', 'lead-c'];

/** Entries need a suite, a spec path (repo-relative), a line, a lane and a date; returns the problems. */
export function validateQuarantine(list) {
  const bad = [];
  list.forEach((e, i) => {
    const at = `quarantine[${i}] ${e?.file ?? '?'}:${e?.line ?? '?'}`;
    if (!e?.suite || !e.file || !Number.isInteger(e.line))
      bad.push(`${at}: needs suite, file and an integer line`);
    if (!LANES.includes(e?.lane)) bad.push(`${at}: lane must be one of ${LANES.join(', ')}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.since ?? '')) bad.push(`${at}: since must be a date (YYYY-MM-DD)`);
  });
  return bad;
}

export const loadQuarantine = (cwd) =>
  JSON.parse(readFileSync(`${cwd}/scripts/e2e/quarantine.json`, 'utf8')).entries;

/** Failing and passing tests of one suite report: `{ file (repo-relative), line, status }`. */
export function testsOf(report, suite) {
  const out = [];
  const visit = (s) => {
    for (const spec of s.specs ?? [])
      for (const t of spec.tests ?? [])
        out.push({ file: posix.join(rootOf(suite), spec.file), line: spec.line, status: t.status });
    (s.suites ?? []).forEach(visit);
  };
  (report.suites ?? []).forEach(visit);
  return out;
}

/**
 * Judges the reports of the selected suites against the quarantine. A suite is red when it has an unexpected test that no
 * entry names. Stale entries (the spec ran green, or the file is gone) are reported, never removed here.
 * @returns {{ failed: string[], quarantined: string[], stale: string[] }}
 */
export function judge(runs, quarantine, exists = () => true) {
  const key = (e) => `${e.file}:${e.line}`;
  const q = new Map(quarantine.map((e) => [key(e), e]));
  const failed = [];
  const quarantined = [];
  const stale = quarantine
    .filter((e) => !exists(e.file))
    .map((e) => `${key(e)} (${e.lane}, since ${e.since}): the file is gone`);
  for (const { suite, report, code } of runs) {
    if (!report) {
      failed.push(`${suite.name} (no report)`);
      continue;
    }
    const red = [];
    const tests = testsOf(report, suite);
    const attributed = tests.filter((t) => t.status === 'unexpected').length;
    // infrastructure failures leave no failing test: report errors, a non-zero exit nobody explains, unattributed failures
    const errors = (report.errors ?? []).length;
    const unknown = Math.max(0, (report.stats?.unexpected ?? 0) - attributed);
    for (const t of tests) {
      const entry = q.get(key(t));
      if (t.status === 'unexpected' || t.status === 'flaky') {
        if (entry) quarantined.push(`${key(t)} (${entry.lane}, since ${entry.since})`);
        else if (t.status === 'unexpected') red.push(key(t));
      } else if (entry && t.status === 'expected')
        stale.push(`${key(t)} (${entry.lane}, since ${entry.since}): green now`);
    }
    const quarantinedOnly = tests.some((t) => t.status === 'unexpected') && red.length === 0;
    if (errors > 0) red.push(`${errors} report error(s): ${report.errors[0]?.message ?? '?'}`.slice(0, 200));
    if (unknown > 0) red.push(`${unknown} failure(s) not attributed to a spec`);
    if (code !== undefined && code !== 0 && red.length === 0 && !quarantinedOnly)
      red.push(`exit ${code} with no failing test (infrastructure)`);
    if (red.length) failed.push(`${suite.name}: ${[...new Set(red)].join(', ')}`);
  }
  return { failed, quarantined: [...new Set(quarantined)], stale: [...new Set(stale)] };
}
