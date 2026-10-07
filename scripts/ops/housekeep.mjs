// Disk and RAM hygiene for the shared dev machine (docs/process/lead-loop.md, step 1).
// Dry run by default: it prints every candidate with size and reason. `--apply` deletes exactly those. It never uses
// --force on a worktree and never touches reference/, metrics/raw/*.jsonl, or a worktree with uncommitted work or a live process.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventLines } from '../metrics/flow.mjs';
import { listOf, statOf } from './housekeep.fs.mjs';
import { procCwdsDefault, prunePwCache, pwCacheCandidates, runTmpCandidates } from './housekeep.runtmp.mjs';
import {
  cacheCandidates,
  copyCandidates,
  removeCopyKind,
  vitestCacheCandidates,
} from './housekeep.copies.mjs';
import { orphanLine, orphanCandidates, readProcsDefault, terminate } from './housekeep.orphans.mjs';
import { parseMeminfo, readPsi, swapStarved } from './memory.mjs';
import { git, gitOk, hasOwnCommits, lastActivity, newestMtime, SCAN_LIMIT } from './housekeep.activity.mjs';

export { newestMtime };

export const DISK_CLEAN_PCT = 75; // clean above this
export const DISK_STOP_PCT = 85; // still above this after cleanup: stop dispatching
export const RAM_LIMIT_MB = 16 * 1024; // below: at most 4 implementers per lead
export const RAM_STOP_MB = 8 * 1024; // below (or memory short with swap over half used): dispatch nothing
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MAX_AGE = { tmp: 10 * MIN, worktree: 2 * 60 * MIN, log: 7 * DAY };
const HARNESS_LOCK = /^claude agent\b/;
const BRANCH_PREFIXES = ['docsync/', 'worktree-agent-'];
const TMP_NAME = /^[A-Za-z0-9_-]{21}$/;

/** Pure: paths that are never deleted, whatever pattern matched them. */
export function isProtected(path, repo) {
  const p = resolve(path);
  const ref = resolve(repo, 'reference');
  return (
    p === ref ||
    p.startsWith(ref + sep) ||
    p.split(sep).includes('node_modules') ||
    basename(p).endsWith('.jsonl') ||
    basename(p) === 'ATTENTION.md'
  );
}

export const pidAliveDefault = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

export function sizeKb(path) {
  try {
    return Number(execFileSync('du', ['-sk', path], { encoding: 'utf8' }).split(/\s/)[0]);
  } catch {
    return 0;
  }
}

/** Parses `git worktree list --porcelain`. */
export function parseWorktrees(text) {
  return text
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const w = { path: '', head: '', branch: null, detached: false, locked: null, prunable: false };
      for (const line of block.split('\n')) {
        const [key, ...rest] = line.split(' ');
        const val = rest.join(' ');
        if (key === 'worktree') w.path = val;
        else if (key === 'HEAD') w.head = val;
        else if (key === 'branch') w.branch = val.replace('refs/heads/', '');
        else if (key === 'detached') w.detached = true;
        else if (key === 'locked') w.locked = val;
        else if (key === 'prunable') w.prunable = true;
      }
      return w;
    });
}

/** Age of the entry, or undefined when it vanished. */
const ageMs = (path, now) => {
  const st = statOf(path);
  return st && now - st.mtimeMs;
};
const within = (dir, path) => path === dir || path.startsWith(dir + sep);

function tmpCandidates(o) {
  const found = [];
  if (!existsSync(o.tmp)) return found;
  for (const name of listOf(o.tmp) ?? []) {
    const dir = join(o.tmp, name);
    if (!TMP_NAME.test(name) || isProtected(dir, o.repo)) continue;
    const st = statOf(dir);
    if (!st?.isDirectory() || st.isSymbolicLink()) continue;
    const entries = listOf(dir);
    if (!entries?.length || entries.some((e) => e !== 'client' && e !== 'ssr')) continue;
    const age = ageMs(dir, o.now);
    if (age === undefined || age < MAX_AGE.tmp) continue;
    found.push({
      kind: 'tmp',
      path: dir,
      reason: 'leaked build dir (only client/ssr), older than 10 min',
    });
  }
  return found;
}

function lockHolderAlive(o, w) {
  const pid = Number(w.locked.match(/pid[ =:]*(\d+)/i)?.[1] ?? NaN);
  if (Number.isNaN(pid)) return 'locked, no pid in the reason';
  return o.pidAlive(pid) ? `locked by live pid ${pid}` : '';
}

/** True when the events log of the worktree's wp/* branch says its last land outcome was `merged`. */
export function isLanded(repo, branch) {
  const id = branch?.match(/^wp\/(WP-\d+(?:\.\d+)*)$/)?.[1];
  if (!id) return false;
  try {
    const last = eventLines(id, repo)
      .filter((l) => / (merged|reverted|refused)\b/.test(l))
      .pop();
    return / merged\b/.test(last ?? '');
  } catch {
    return false;
  }
}

/** The one keep decision: why a worktree must stay, or '' when it may go. */
function keepReason(o, w, cwds) {
  if (w.locked !== null) {
    const why = lockHolderAlive(o, w);
    // The harness locks agent worktrees with the lead's long-lived pid. For a landed branch that
    // lock says nothing about the work, so the 2 h activity check below replaces it. Other locks stand.
    const overridable = HARNESS_LOCK.test(w.locked) && isLanded(o.repo, w.branch);
    if (why && !overridable) return why;
  }
  if (cwds.some((c) => within(w.path, c))) return 'a live process works inside it';
  const name = w.branch ?? 'detached HEAD';
  if (!gitOk(['merge-base', '--is-ancestor', w.head, o.main], o.repo))
    return `${name} is not merged into ${o.main}`;
  if (!isLanded(o.repo, w.branch) && !hasOwnCommits(w)) return `${name} has no commits of its own yet`;
  let dirty = true;
  try {
    dirty = git(['--no-optional-locks', 'status', '--porcelain'], w.path).trim() !== '';
  } catch {
    /* unreadable: treat as dirty */
  }
  if (dirty) return 'uncommitted work';
  let act;
  try {
    act = lastActivity(w);
  } catch (e) {
    // One unreadable worktree must neither crash housekeep nor be removed: keep it and say why.
    return `activity unreadable: ${e?.code ?? 'error'}`;
  }
  if (act.truncated) return `too many files to check for activity (over ${SCAN_LIMIT})`;
  if (o.now - act.at < MAX_AGE.worktree) return `active in the last 2 h (${act.what})`;
  return '';
}

const lockNote = (o, w) =>
  lockHolderAlive(o, w) ? ', landed, harness lock ignored' : ', lock holder is dead';

function worktreeCandidates(o, worktrees, skipped) {
  const root = join(realpathSync(o.repo), '.claude', 'worktrees') + sep;
  const cwds = [realpathSync(o.cwd), ...o.procCwds()];
  const found = [];
  for (const w of worktrees) {
    if (!w.path.startsWith(root)) continue;
    if (w.prunable) {
      found.push({ kind: 'prune', path: w.path, reason: 'directory is gone, prune the record' });
      continue;
    }
    if (isProtected(w.path, o.repo)) continue;
    const why = keepReason(o, w, cwds);
    if (why) {
      skipped.push({ kind: 'worktree', path: w.path, reason: why });
      continue;
    }
    found.push({
      kind: 'worktree',
      path: w.path,
      unlock: w.locked !== null,
      branch: w.branch,
      reason: `${w.branch ?? 'detached HEAD'} merged into ${o.main}, clean, idle over 2 h, no live process${w.locked === null ? '' : lockNote(o, w)}`,
    });
  }
  return found;
}

function branchCandidates(o, worktrees, removing) {
  const checkedOut = new Set(worktrees.filter((w) => !removing.has(w.path)).map((w) => w.branch));
  const merged = git(['for-each-ref', '--merged', o.main, '--format=%(refname:short)', 'refs/heads'], o.repo)
    .split('\n')
    .filter(Boolean);
  return merged
    .filter((b) => b !== o.main && BRANCH_PREFIXES.some((p) => b.startsWith(p)) && !checkedOut.has(b))
    .map((b) => ({ kind: 'branch', branch: b, reason: `merged into ${o.main}` }));
}

function logCandidates(o) {
  if (!existsSync(o.logDir)) return [];
  return (listOf(o.logDir) ?? [])
    .map((n) => join(o.logDir, n))
    .filter((f) => f.endsWith('.md') && !isProtected(f, o.repo))
    .filter((f) => statOf(f)?.isFile() && (ageMs(f, o.now) ?? 0) > MAX_AGE.log)
    .map((f) => ({ kind: 'log', path: f, reason: 'logwatch report older than 7 days' }));
}

export function withDefaults(opts) {
  const repo = resolve(opts.repo);
  return {
    repo,
    tmp: opts.tmp ?? tmpdir(),
    main: opts.main ?? 'main',
    now: opts.now ?? Date.now(),
    cwd: opts.cwd ?? process.cwd(),
    pidAlive: opts.pidAlive ?? pidAliveDefault,
    procCwds: opts.procCwds ?? procCwdsDefault,
    procs: opts.procs ?? (() => []), // main() passes readProcsDefault; specs stay off the real /proc
    orphanExists: opts.orphanExists ?? existsSync,
    logDir: opts.logDir ?? join(repo, 'metrics', 'raw', 'logwatch'),
    cacheSoftMb: opts.cacheSoftMb,
  };
}

/** Returns { candidates, skipped } in deletion order. Reads only, deletes nothing. */
export function plan(opts) {
  const o = withDefaults(opts);
  const skipped = [];
  const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain'], o.repo));
  const wts = worktreeCandidates(o, worktrees, skipped);
  const removing = new Set(wts.filter((c) => c.kind === 'worktree').map((c) => c.path));
  const candidates = [
    ...tmpCandidates(o),
    ...runTmpCandidates(o, isProtected),
    ...pwCacheCandidates(o),
    ...cacheCandidates(o),
    ...copyCandidates(o, worktrees, skipped),
    // merged: its commits are in main (or the events log says so), and it has commits of its own
    ...vitestCacheCandidates(
      o,
      worktrees,
      (w) =>
        gitOk(['merge-base', '--is-ancestor', w.head, o.main], o.repo) &&
        (isLanded(o.repo, w.branch) || hasOwnCommits(w)),
    ),
    ...wts,
    ...branchCandidates(o, worktrees, removing),
    ...logCandidates(o),
    ...orphanCandidates(o.procs(), { exists: o.orphanExists }),
  ].map((c) => ({ ...c, kb: c.kb ?? (c.path && existsSync(c.path) ? sizeKb(c.path) : 0) }));
  return { candidates, skipped };
}

/** Deletes one candidate. Never passes --force. Returns an error text, or '' on success. */
export function remove(c, opts) {
  const repo = resolve(opts.repo);
  let relock = null; // the lock reason to put back when the removal fails after the unlock
  try {
    if (c.kind === 'orphan') terminate(c.pid, opts.kill ?? process.kill, opts.killGraceMs);
    else if (c.kind === 'tmp' || c.kind === 'log') rmSync(c.path, { recursive: true });
    else if (c.kind === 'cache' || c.kind === 'copy' || c.kind === 'vitest-cache') removeCopyKind(c, repo);
    else if (c.kind === 'pwcache') prunePwCache(c);
    else if (c.kind === 'prune') git(['worktree', 'prune'], repo);
    else if (c.kind === 'branch') git(['branch', '-d', c.branch], repo);
    else {
      if (c.unlock) {
        const reason = parseWorktrees(git(['worktree', 'list', '--porcelain'], repo)).find(
          (w) => w.path === c.path,
        )?.locked;
        git(['worktree', 'unlock', c.path], repo);
        relock = reason ?? '';
      }
      git(['worktree', 'remove', c.path], repo);
    }
    return '';
  } catch (e) {
    let text = String(e.stderr || e.message).trim();
    if (relock !== null) {
      try {
        git(['worktree', 'lock', ...(relock ? ['--reason', relock] : []), c.path], repo);
        text += `\n(lock restored: ${relock || 'no reason'})`;
      } catch (e2) {
        text += `\n(could NOT restore the lock ${JSON.stringify(relock)}: ${String(e2.stderr || e2.message).trim()})`;
      }
    }
    return text;
  }
}

export function diskUsage(path = '/') {
  const f = execFileSync('df', ['-Pk', path], { encoding: 'utf8' }).trim().split('\n').pop().split(/\s+/);
  return { usedPct: Number(f[4].replace('%', '')), freeGb: Math.round(Number(f[3]) / 1024 / 1024) };
}

export function memory(text = readFileSync('/proc/meminfo', 'utf8'), pressure = readPsi('memory')) {
  const m = parseMeminfo(text);
  return { ...m, availMb: m.memAvailMb, pressure };
}

/** Pure: the dispatch rule (owner 2026-09-30). Swap counts only when memory is short (scripts/ops/memory.mjs). */
export function ramAdvice(m) {
  const gb = (mb) => Math.round(mb / 1024);
  const p = m.pressure ?? { some: 0 };
  if (m.availMb < RAM_STOP_MB)
    return `RAM: dispatch nothing until it recovers (available ${gb(m.availMb)} GB < ${gb(RAM_STOP_MB)} GB)`;
  if (swapStarved({ ...m, memAvailMb: m.availMb }, p)) {
    const why = p.some > 1 ? `PSI ${p.some}` : `available ${gb(m.availMb)} of ${gb(m.memTotalMb)} GB`;
    return `RAM: dispatch nothing until it recovers (memory short: ${why}, swap ${m.swapUsedMb}/${m.swapTotalMb} MB used)`;
  }
  if (m.availMb < RAM_LIMIT_MB) return 'RAM: at most 4 implementers per lead (available < 16 GB)';
  return 'RAM: ok, up to 8 implementers per lead';
}

const KINDS = 'tmp pwcache cache copy vitest-cache prune worktree branch log orphan'.split(' ');
const size = (kb) =>
  kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`;
const line = (kind, c) =>
  `  ${kind.padEnd(8)} ${(c.path ?? c.branch).padEnd(60)} ${size(c.kb).padStart(9)}  ${c.reason}`;

function state(label, out) {
  const d = diskUsage();
  const m = memory();
  out(
    `${label}: disk / ${d.usedPct}% used, ${d.freeGb} GB free; RAM ${m.availMb} MB available, swap ${m.swapUsedMb} MB used`,
  );
  return { d, m };
}

export const REMOVE_HINT = {
  branch: (c) => `git branch -d ${c.branch}`,
  cache: (c) => `rm -rf ${c.path}`,
  'vitest-cache': (c) => `rm -rf ${c.path}`,
  copy: (c) => `cd ${c.path} && node scripts/ops/link-node-modules.mjs`,
};

/** Applies every candidate; returns the failure count and prints the MB of vitest module cache freed (WP-993). */
export function applyAll(candidates, repo, out) {
  let failed = 0;
  let freedKb = 0;
  for (const c of candidates) {
    const err = remove(c, { repo });
    if (!err) {
      if (c.kind === 'vitest-cache') freedKb += c.kb;
      if (c.report) out(c.report);
      continue;
    }
    failed++;
    const by = REMOVE_HINT[c.kind]?.(c) ?? `git worktree remove ${c.path}`;
    out(`  FAILED ${c.kind} ${c.path ?? c.branch ?? c.pid}: ${err}`);
    out(`  Needs user: ${by}`);
  }
  if (candidates.some((c) => c.kind === 'vitest-cache'))
    out(`vitest module cache freed: ${Math.round(freedKb / 1024)} MB`);
  return failed;
}

export function main(argv, out = console.log) {
  if (argv.includes('--force')) throw new Error('housekeep never forces a worktree removal');
  const apply = argv.includes('--apply');
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], process.cwd()).trim();
  const repo = common.replace(/\/\.git$/, '');
  const before = state('before', out);
  const { candidates, skipped } = plan({ repo, procs: readProcsDefault });
  out(apply ? 'mode: APPLY' : 'mode: dry run (nothing is deleted; pass --apply)');
  const verbose = argv.includes('--verbose');
  for (const kind of KINDS) {
    const group = candidates.filter((c) => c.kind === kind);
    if (group.length > 5 && !verbose) {
      const kb = group.reduce((n, c) => n + c.kb, 0);
      out(
        `  ${kind.padEnd(8)} ${group.length} candidates ${size(kb).padStart(9)}  ${group[0].reason} (--verbose lists them)`,
      );
    } else for (const c of group) out(orphanLine(c) ?? line(kind, c));
  }
  for (const s of skipped) out(`  kept     ${s.path}  (${s.reason})`);
  if (!candidates.length) out('  no candidates');
  out(`total: ${candidates.length} candidates, ${size(candidates.reduce((n, c) => n + c.kb, 0))}`);
  const failed = apply ? applyAll(candidates, repo, out) : 0;
  const after = apply ? state('after', out) : before;
  out(ramAdvice(after.m));
  if (!apply && before.d.usedPct > DISK_CLEAN_PCT)
    out(`disk above ${DISK_CLEAN_PCT}%: run npm run housekeep -- --apply`);
  if (apply && after.d.usedPct > DISK_STOP_PCT) {
    out(`disk still above ${DISK_STOP_PCT}% after cleanup: stop dispatching, find the cause`);
    out('  du -xsh /tmp ~/ueberblick-v4* ~/.cache ~/.npm | sort -h   then write a fix work package');
    return 2;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
