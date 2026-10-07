// Delivery flow from git and lead events (work/events/<WP>.log plus the pending ones in
// <git common dir>/land-pending, see eventLines; written by npm run wp:event and npm run land; older WP `## Log` lines are read too). Event lines: `YYYY-MM-DD HH:MM <event>` with event one of
//   start · review <n> PASS|FAIL · blocked · unblocked · escalated · refused check|install|conflict (older logs: reverted …) · merged <sha>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { git } from './lib.mjs';

/** Event lines of a work package: committed (work/events/<WP>.log), then pending (<git common dir>/land-pending/<WP>.log, not yet folded by land). Exact duplicates appear once (first occurrence kept, order unchanged): a fold that died between its append and its rm leaves the same line in work/events and in a leftover .folding. */
export function eventLines(id, repo = '.') {
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
  let pending = [];
  try {
    const common = execFileSync(
      'git',
      ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    const dir = join(common, 'land-pending');
    // `<WP>.log.folding*` is a fold in progress (or left by a land that died): still pending.
    const names = existsSync(dir)
      ? readdirSync(dir)
          .filter((n) => n.startsWith(`${id}.log.folding`))
          .sort()
      : [];
    pending = [...names.flatMap((n) => read(join(dir, n))), ...read(join(dir, `${id}.log`))];
  } catch {
    // not a git repository: committed lines only
  }
  const lines = [...read(join(repo, 'work', 'events', `${id}.log`)), ...pending];
  const seen = new Set();
  const out = [];
  for (const l of lines)
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  return out;
}

const EVENT =
  /^-?\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?:?\s+(start|review\s+\d+\s+(?:PASS|FAIL)|blocked|unblocked|escalated|(?:reverted|refused)\s+(?:check|install|conflict)|merged)\b/i;

/** One work-package file → id, status, major flag and its Log events. */
export function parseWp(text) {
  const fm = text.split('---')[1] ?? '';
  const get = (k) => (fm.match(new RegExp(`^${k}:\\s*([^#\\n]*)`, 'm'))?.[1] ?? '').trim();
  const log = (text.split(/^## Log\s*$/m)[1] ?? '').split('\n');
  const events = log.flatMap((l) => {
    const m = l.match(EVENT);
    return m
      ? [{ at: new Date(`${m[1]}T${m[2] ?? '12:00'}:00`), event: m[3].toLowerCase().replace(/\s+/g, ' ') }]
      : [];
  });
  return { id: get('id'), status: get('status'), major: get('major') === 'true', events };
}

/** Flow numbers of one merged work package, or null if it has no `merged` event. */
export function summarize(w) {
  const merged = w.events.find((e) => e.event === 'merged');
  if (!merged) return null;
  const start = w.events.find((e) => e.event === 'start');
  const reviews = w.events.filter((e) => e.event.startsWith('review'));
  let blockedMs = 0;
  let blockedAt = null;
  for (const e of w.events) {
    if (e.event === 'blocked') blockedAt = e.at;
    if (e.event === 'unblocked' && blockedAt) {
      blockedMs += e.at - blockedAt;
      blockedAt = null;
    }
  }
  return {
    id: w.id,
    major: w.major,
    mergedAt: merged.at,
    cycleMs: start ? merged.at - start.at : null,
    rounds: reviews.length,
    firstPass: reviews.length > 0 && reviews[0].event.endsWith('pass'),
    blockedMs,
    escalated: w.events.some((e) => e.event === 'escalated'),
    reverts: w.events.filter((e) => /^(reverted|refused)\b/.test(e.event)).length,
  };
}

/** Merged work packages inside [since, until). */
export function wpFlow(since, until, repo = '.') {
  return readdirSync(resolve(repo, 'work'))
    .filter((f) => /^WP-\d+.*\.md$/.test(f))
    .map((f) => {
      const w = parseWp(readFileSync(resolve(repo, 'work', f), 'utf8'));
      w.events.push(...parseWp(`## Log\n${eventLines(w.id, repo).join('\n')}`).events);
      w.events.sort((a, b) => a.at - b.at);
      return summarize(w);
    })
    .filter((w) => w && w.mergedAt >= since && w.mergedAt < until);
}

/** Commits on main (first parent) in the window, classified. */
export function mainCommits(since, until) {
  const out = git(
    'log',
    'main',
    '--first-parent',
    `--since=${since.toISOString()}`,
    `--until=${until.toISOString()}`,
    '--format=%H%x09%ct%x09%s%x09%(trailers:key=Fixes-WP,valueonly,separator=%x2C)',
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, ct, subject, fixes] = l.split('\t');
      return {
        sha: sha.slice(0, 7),
        at: new Date(Number(ct) * 1000),
        subject,
        fixesWp: fixes?.trim() || null,
        revert: /^Revert /.test(subject),
        docsync: /docsync\//.test(subject),
      };
    });
}
