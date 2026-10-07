import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
// @ts-expect-error plain .mjs without declarations
import { descendants, isAlive, reapTree } from './server-reap.mjs';

const REAP = fileURLToPath(new URL('./server-reap.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'ueberblick-reap-spec-'));
const spawned: number[] = [];
afterAll(() => {
  for (const p of spawned)
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      /* gone */
    }
  rmSync(dir, { recursive: true, force: true });
});

const alive = isAlive as (pid: number) => boolean;
const until = async (f: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 40));
  return f();
};

// A runner the way run.mjs is built: it installs the reaper, starts a polite server and one that ignores SIGTERM
// (like the node build server), the latter in its own process group like Playwright's webServer.
const RUNNER = `
import { spawn } from 'node:child_process';
import { installReaper } from ${JSON.stringify(REAP)};
installReaper({ graceMs: 300 });
const polite = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
const stubborn = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore', detached: true });
console.log(JSON.stringify({ polite: polite.pid, stubborn: stubborn.pid }));
setInterval(() => {}, 1000);
`;

async function startRunner(): Promise<{ pid: number; polite: number; stubborn: number }> {
  const file = join(dir, `runner-${spawned.length}.mjs`);
  writeFileSync(file, RUNNER);
  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'], env: specEnv() });
  const cpid = child.pid ?? 0;
  spawned.push(cpid);
  const line = await new Promise<string>((resolve) => child.stdout.once('data', (d) => resolve(String(d))));
  const { polite, stubborn } = JSON.parse(line) as { polite: number; stubborn: number };
  spawned.push(polite, stubborn);
  await new Promise((r) => setTimeout(r, 150)); // let the stubborn server install its SIGTERM handler
  return { pid: cpid, polite, stubborn };
}

describe('descendants', () => {
  it('walks the parent chain below the root, not beside it', () => {
    const procs = [
      { pid: 2, ppid: 1, cmdline: '' },
      { pid: 3, ppid: 2, cmdline: '' },
      { pid: 4, ppid: 3, cmdline: '' },
      { pid: 5, ppid: 9, cmdline: '' },
    ];
    expect(descendants(2, procs)).toEqual([3, 4]);
    expect(descendants(7, procs)).toEqual([]);
  });
});

describe('installReaper', () => {
  it('SIGTERM to the runner takes its servers down, SIGKILLing the one that ignores SIGTERM', async () => {
    const r = await startRunner();
    expect(alive(r.polite) && alive(r.stubborn)).toBe(true);
    process.kill(r.pid, 'SIGTERM');
    expect(await until(() => !alive(r.polite) && !alive(r.stubborn))).toBe(true);
    expect(await until(() => !alive(r.pid))).toBe(true);
  }, 20000);

  it('SIGHUP and SIGINT do the same', async () => {
    for (const sig of ['SIGHUP', 'SIGINT'] as const) {
      const r = await startRunner();
      process.kill(r.pid, sig);
      expect(await until(() => !alive(r.polite) && !alive(r.stubborn))).toBe(true);
    }
  }, 30000);
});

describe('reapTree pid reuse', () => {
  const procs = () => [
    { pid: 50, ppid: 10, cmdline: '' },
    { pid: 51, ppid: 50, cmdline: '' },
  ];
  it('sends no SIGKILL to a pid whose start time changed during the grace period', async () => {
    const sent: string[] = [];
    let reused = false;
    const startOf = (p: number) => (p === 51 && reused ? 'other' : `t${p}`);
    const kill = (p: number, sig: string) => {
      sent.push(`${p}:${sig}`);
      if (sig === 'SIGTERM') reused = true; // 51 exits, an unrelated process takes the pid
    };
    const killed = await (reapTree as (r: number, o: object) => Promise<number[]>)(10, {
      procs,
      kill,
      graceMs: 60,
      alive: () => true,
      startOf,
    });
    expect(sent).toContain('50:SIGKILL');
    expect(sent).not.toContain('51:SIGKILL');
    expect(killed).toEqual([50]);
  });
});
