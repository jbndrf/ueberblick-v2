// Orphaned test workers (WP-1000): vitest or playwright workers reparented to init whose checkout is gone.
// They are leftovers of killed agents. Pure detection here; the caller kills one exact pid.
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';

const WORKER =
  /(\S+)\/node_modules\/(?:vitest\/dist\/workers\/(?:forks|threads)\.js|(?:@playwright\/test|playwright(?:-core)?)\/\S*worker\S*)(?:\s|$)/;

/** Pure: workers with ppid 1 whose checkout root (the dir holding node_modules) no longer exists. */
export function orphanWorkerCandidates(procs, { exists = existsSync } = {}) {
  const found = [];
  for (const p of procs) {
    if (p.ppid !== 1) continue;
    const root = p.cmdline.match(WORKER)?.[1];
    if (!root || !root.startsWith('/') || exists(root)) continue;
    const kind = p.cmdline.includes('vitest') ? 'vitest' : 'playwright';
    found.push({ kind: 'orphan', pid: p.pid, reason: `${kind} worker, worktree gone` });
  }
  return found;
}

// e2e app servers (WP-1030): Playwright's webServer runs `node build/index.js` (under `sh -c`) with the cwd apps/web of
// the checkout. A demo server is started with an absolute path, so it never matches.
const SERVER = /^(?:sh -c )?node build\/index\.js$/;
const DELETED = / \(deleted\)$/;

/** Pure: e2e app servers with ppid 1 whose working directory is deleted or whose checkout (the dir holding apps/web) is gone. */
export function orphanServerCandidates(procs, { exists = existsSync } = {}) {
  const found = [];
  for (const p of procs) {
    if (p.ppid !== 1 || !SERVER.test(p.cmdline) || !p.cwd) continue;
    const deleted = DELETED.test(p.cwd);
    const checkout = p.cwd.replace(/\/apps\/web$/, '');
    if (!deleted && exists(checkout)) continue;
    found.push({ kind: 'orphan', pid: p.pid, reason: 'e2e app server, checkout gone' });
  }
  return found;
}

/** Every orphan kind: test workers and e2e app servers. */
export const orphanCandidates = (procs, o) => [
  ...orphanWorkerCandidates(procs, o),
  ...orphanServerCandidates(procs, o),
];

/** True while the pid exists and is not a zombie. */
export function isAlive(pid, { proc = '/proc', kill = process.kill } = {}) {
  try {
    kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const s = readFileSync(`${proc}/${pid}/stat`, 'utf8');
    return s[s.lastIndexOf(')') + 2] !== 'Z'; // the state letter is the first field after the last ')'
  } catch {
    return true;
  }
}

/** Start time (field 22 of /proc/<pid>/stat, in clock ticks since boot): with the pid it names one process, not a reused pid. */
export function startTime(pid, proc = '/proc') {
  try {
    const s = readFileSync(`${proc}/${pid}/stat`, 'utf8');
    return s.slice(s.lastIndexOf(')') + 2).split(' ')[19]; // the slice starts at field 3 (state), so field 22 is index 19
  } catch {
    return undefined;
  }
}

/**
 * SIGTERM to exactly this pid, then SIGKILL after `graceMs` when it is still alive (the node servers ignore SIGTERM)
 * and still the same process (start time unchanged: a reused pid is never killed).
 */
export function terminate(pid, kill = process.kill, graceMs = 5000, alive = isAlive, startOf = startTime) {
  const born = startOf(pid);
  kill(pid, 'SIGTERM');
  const t = setTimeout(() => {
    if (born === undefined || !alive(pid) || startOf(pid) !== born) return; // no identity: never SIGKILL
    try {
      kill(pid, 'SIGKILL');
    } catch {
      /* gone meanwhile */
    }
  }, graceMs);
  return t;
}

/** Linux only: reads /proc/<pid>/{stat,cmdline}. Without /proc it returns []. */
export function readProcsDefault(proc = '/proc') {
  let names;
  try {
    names = readdirSync(proc).filter((n) => /^\d+$/.test(n));
  } catch {
    return [];
  }
  const procs = [];
  for (const n of names) {
    try {
      const stat = readFileSync(`${proc}/${n}/stat`, 'utf8');
      // The comm field may hold spaces and parentheses: ppid is the 2nd field after the last ')'.
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const cmdline = readFileSync(`${proc}/${n}/cmdline`, 'utf8').split('\0').join(' ').trim();
      let cwd;
      try {
        cwd = readlinkSync(`${proc}/${n}/cwd`);
      } catch {
        /* not ours to read */
      }
      procs.push({ pid: Number(n), ppid, cmdline, cwd });
    } catch {
      /* the process exited meanwhile */
    }
  }
  return procs;
}

/** The dry-run line of an orphan candidate; undefined for any other kind. */
export const orphanLine = (c) => (c.kind === 'orphan' ? `  orphan   pid ${c.pid}  ${c.reason}` : undefined);
