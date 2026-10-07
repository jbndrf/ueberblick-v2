import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import {
  isAlive,
  orphanCandidates,
  orphanServerCandidates,
  orphanWorkerCandidates,
  readProcsDefault,
  terminate,
} from './housekeep.orphans.mjs';
import { plan, remove, type Candidate } from './housekeep.mjs';

const gone = () => false;
const here = () => true;
const wt = '/home/u/repo/.claude/worktrees/agent-x';
const forks = `node ${wt}/node_modules/vitest/dist/workers/forks.js`;
const proc = (cmdline: string, ppid = 1, pid = 10) => ({ pid, ppid, cmdline });

describe('orphanWorkerCandidates', () => {
  it('finds a ppid-1 forks worker under a missing worktree', () => {
    expect(orphanWorkerCandidates([proc(forks)], { exists: gone })).toEqual([
      { kind: 'orphan', pid: 10, reason: 'vitest worker, worktree gone' },
    ]);
  });
  it('finds a threads worker under a missing checkout', () => {
    const c = 'node /gone/node_modules/vitest/dist/workers/threads.js';
    expect(orphanWorkerCandidates([proc(c)], { exists: gone })).toHaveLength(1);
  });
  it('checks the checkout root, not the file', () => {
    const seen: string[] = [];
    orphanWorkerCandidates([proc(forks)], { exists: (p: string) => (seen.push(p), false) });
    expect(seen).toEqual([wt]);
  });
  it('skips a worker whose checkout still exists', () => {
    expect(orphanWorkerCandidates([proc(forks)], { exists: here })).toEqual([]);
  });
  it('skips ppid other than 1', () => {
    expect(orphanWorkerCandidates([proc(forks, 4242)], { exists: gone })).toEqual([]);
  });
  it('skips a non-vitest node process and a cmdline without a path', () => {
    const other = proc('node /gone/node_modules/.bin/eslint src');
    const bare = proc('node forks.js');
    expect(orphanWorkerCandidates([other, bare], { exists: gone })).toEqual([]);
  });
});

describe('orphan kind', () => {
  it('remove() sends SIGTERM to exactly that pid', () => {
    const calls: unknown[][] = [];
    const c = { kind: 'orphan', pid: 1319484, reason: 'x', kb: 0 } as unknown as Candidate;
    const kill = (...a: unknown[]) => calls.push(a);
    expect(remove(c, { repo: '/', kill } as never)).toBe('');
    expect(calls).toEqual([[1319484, 'SIGTERM']]);
  });
  it('plan() lists orphans from the injected process reader', () => {
    const { candidates } = plan({
      repo: process.cwd(),
      procs: () => [proc(forks, 1, 77)],
      orphanExists: gone,
    } as never);
    expect(candidates.filter((x) => (x.kind as string) === 'orphan')).toHaveLength(1);
  });
  it('the default reader returns well-formed entries', () => {
    const me = readProcsDefault().find((p: { pid: number }) => p.pid === process.pid);
    expect(me?.ppid).toBe(process.ppid);
  });
});

describe('e2e app servers (WP-1030)', () => {
  const server = (cwd: string | undefined, o: { ppid?: number; cmdline?: string; pid?: number } = {}) => ({
    pid: o.pid ?? 20,
    ppid: o.ppid ?? 1,
    cmdline: o.cmdline ?? 'node build/index.js',
    cwd,
  });
  const live = '/home/u/repo/apps/web';
  it('lists a parent-1 server whose working directory is deleted, even when the path exists again', () => {
    const got = orphanServerCandidates([server(`${live} (deleted)`)], { exists: here });
    expect(got).toEqual([{ kind: 'orphan', pid: 20, reason: 'e2e app server, checkout gone' }]);
  });
  it('lists the sh -c wrapper and a server whose checkout is gone', () => {
    const wrapper = server(live, { cmdline: 'sh -c node build/index.js', pid: 21 });
    expect(orphanServerCandidates([server(live), wrapper], { exists: gone }).map((c) => c.pid)).toEqual([
      20, 21,
    ]);
  });
  it('checks the checkout (the dir holding apps/web), not the working directory', () => {
    const seen: string[] = [];
    orphanServerCandidates([server(live)], { exists: (p: string) => (seen.push(p), true) });
    expect(seen).toEqual(['/home/u/repo']);
  });
  it('skips a server whose checkout still exists, one with a live parent, and unreadable cwd', () => {
    const procs = [server(live), server(`${live}`, { ppid: 4242 }), server(undefined)];
    expect(orphanServerCandidates(procs, { exists: here })).toEqual([]);
  });
  it('skips a demo server (absolute path) and other node processes', () => {
    const demo = server('/gone/apps/web', { cmdline: 'node /gone/apps/web/build/index.js' });
    const other = server('/gone/apps/web', { cmdline: 'node build/other.js' });
    expect(orphanServerCandidates([demo, other], { exists: gone })).toEqual([]);
  });
  it('plan() lists servers through orphanCandidates', () => {
    expect(orphanCandidates([server(live), proc(forks, 1, 77)], { exists: gone })).toHaveLength(2);
    const { candidates } = plan({
      repo: process.cwd(),
      procs: () => [server(live)],
      orphanExists: gone,
    } as never);
    expect(candidates.filter((x) => (x.kind as string) === 'orphan')).toHaveLength(1);
  });
});

describe('terminate', () => {
  const spawned: number[] = [];
  afterEach(() => {
    for (const p of spawned.splice(0))
      try {
        process.kill(p, 'SIGKILL');
      } catch {
        /* gone */
      }
  });
  const stubborn = async () => {
    const c = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM',()=>{});console.log('up');setInterval(()=>{},1000)"],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: specEnv(),
      },
    );
    spawned.push(c.pid ?? 0);
    await new Promise((r) => c.stdout.once('data', r));
    return c.pid ?? 0;
  };
  const until = async (f: () => boolean) => {
    for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 40));
    return f();
  };
  it('--apply escalates: SIGTERM first, SIGKILL after the grace when the pid is still alive', async () => {
    const pid = await stubborn();
    const sent: string[] = [];
    const kill = (p: number, sig: string) => (sent.push(sig), process.kill(p, sig as NodeJS.Signals));
    const c = { kind: 'orphan', pid, reason: 'x', kb: 0 } as unknown as Candidate;
    expect(remove(c, { repo: '/', kill, killGraceMs: 200 } as never)).toBe('');
    expect(sent).toEqual(['SIGTERM']);
    await new Promise((r) => setTimeout(r, 100));
    expect(isAlive(pid)).toBe(true); // it ignores SIGTERM
    expect(await until(() => !isAlive(pid))).toBe(true);
    expect(sent).toEqual(['SIGTERM', 'SIGKILL']);
  });
  it('sends no SIGKILL when the pid is gone after SIGTERM', async () => {
    const sent: string[] = [];
    const t = terminate(
      4000000,
      (_p: number, s: string) => void sent.push(s),
      20,
      () => false,
    );
    await new Promise((r) => setTimeout(r, 60));
    clearTimeout(t);
    expect(sent).toEqual(['SIGTERM']);
  });
  it('sends no SIGKILL when the pid was reused (identity changed)', async () => {
    const sent: string[] = [];
    let n = 0;
    const t = terminate(
      4000000,
      (_p: number, s: string) => void sent.push(s),
      20,
      () => true,
      () => `start${n++}`,
    );
    await new Promise((r) => setTimeout(r, 60));
    clearTimeout(t);
    expect(sent).toEqual(['SIGTERM']);
  });
  it('sends no SIGKILL when the identity cannot be read (fails closed)', async () => {
    const sent: string[] = [];
    const t = terminate(
      4000000,
      (_p: number, s: string) => void sent.push(s),
      20,
      () => true,
      () => undefined,
    );
    await new Promise((r) => setTimeout(r, 60));
    clearTimeout(t);
    expect(sent).toEqual(['SIGTERM']);
  });
});
