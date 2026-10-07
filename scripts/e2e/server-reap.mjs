// e2e servers can't leak (WP-1030). Playwright's webServer (`sh -c node build/index.js` + `node build/index.js`) lives
// below run.mjs: runner -> npx -> playwright -> sh -> node. When a runner is killed (an agent's `timeout`, a stopped
// land) the servers used to survive it, and the node server ignores SIGTERM. The reaper walks the runner's process tree
// (by parent pid, so it also finds servers Playwright put in their own process group), sends SIGTERM, then SIGKILL
// after a grace period to whatever is still alive. It never touches a pid outside that tree.
import { isAlive, readProcsDefault, startTime } from '../ops/housekeep.orphans.mjs';

export const GRACE_MS = 5000;
export const SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);
const NUMBER = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/** Pure: every pid below `root` in the parent chain of `procs` (not `root` itself), nearest first. */
export function descendants(root, procs) {
  const kids = new Map();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid]);
  const found = [];
  const seen = new Set([root]);
  for (let i = -1; i < found.length; i++) {
    for (const k of kids.get(i < 0 ? root : found[i]) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      found.push(k);
    }
  }
  return found;
}

export { isAlive };

const send = (kill, pid, sig) => {
  try {
    kill(pid, sig);
  } catch {
    /* already gone */
  }
};

/**
 * SIGTERM to every descendant of `root`, then SIGKILL after `graceMs` to those still alive (polled every 50 ms, so a
 * tree that exits at once returns at once). Resolves with the pids that needed SIGKILL.
 */
export async function reapTree(root, o = {}) {
  const {
    procs = readProcsDefault,
    kill = process.kill,
    graceMs = GRACE_MS,
    alive = isAlive,
    startOf = startTime,
  } = o;
  const pids = descendants(root, procs());
  const born = new Map(pids.map((p) => [p, startOf(p)]));
  for (const pid of pids) send(kill, pid, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  let left = pids.filter((p) => alive(p));
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    left = left.filter((p) => alive(p));
  }
  // a pid that exited and was reused meanwhile has another start time: it is not ours any more
  left = left.filter((p) => born.get(p) !== undefined && alive(p) && startOf(p) === born.get(p)); // no identity: no SIGKILL
  for (const pid of left) send(kill, pid, 'SIGKILL');
  return left;
}

/**
 * Takes the runner's tree down on SIGINT, SIGTERM, SIGHUP (SIGTERM, grace, SIGKILL; exit code 128 + signal) and
 * SIGKILLs any leftover on a normal exit. Returns a function that removes the handlers (for tests).
 */
export function installReaper(o = {}) {
  const { pid = process.pid, ...rest } = o;
  let busy = false;
  const handlers = SIGNALS.map((sig) => {
    const h = async () => {
      if (busy) return;
      busy = true;
      await reapTree(pid, rest);
      process.exit(128 + NUMBER[sig]);
    };
    process.on(sig, h);
    return [sig, h];
  });
  const onExit = () => {
    const { procs = readProcsDefault, kill = process.kill } = rest;
    for (const p of descendants(pid, procs())) send(kill, p, 'SIGKILL');
  };
  process.on('exit', onExit);
  return () => {
    for (const [sig, h] of handlers) process.off(sig, h);
    process.off('exit', onExit);
  };
}
