// WP-1024: the e2e pool's disk guard. The free-space probe is faked through UEB_E2E_FREE_GB; stub commands only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { specEnv } from '../testing/spec-env.mjs';

const GATE = resolve(__dirname, 'check-gate.sh');
let dir: string;
let kids: ChildProcess[] = [];

const start = (pool: string, name: string, freeGb: string) => {
  const stub = `touch ${dir}/${name}.start; while [ ! -e ${dir}/${name}.go ]; do sleep 0.05; done`;
  const c = spawn('bash', [GATE, pool, 'bash', '-c', stub], {
    env: specEnv({
      UEB_CHECK_DIR: join(dir, 'slots'),
      UEB_E2E_SLOTS: '2',
      UEB_E2E_MIN_FREE_GB: '6',
      UEB_E2E_FREE_GB: freeGb,
    }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  c.stderr?.on('data', (d) => (err += d));
  kids.push(c);
  return { err: () => err };
};
const has = (f: string) => existsSync(join(dir, f));
const until = async (f: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
};
const settle = () => new Promise((r) => setTimeout(r, 700));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gate-disk-'));
});
afterEach(() => {
  for (const k of kids) k.kill('SIGKILL');
  kids = [];
  rmSync(dir, { recursive: true, force: true });
});

describe('check-gate e2e disk guard (WP-1024)', () => {
  it('the default threshold is 10 GB (ENOSPC hit e2e at about 8 GB free, 2026-10-04)', () => {
    expect(readFileSync(GATE, 'utf8')).toContain('min_gb=${UEB_E2E_MIN_FREE_GB:-10}');
  });

  it('above the threshold the pool keeps its K=2', async () => {
    const a = start('--e2e', 'a', '20');
    start('--e2e', 'b', '20');
    await until(() => has('a.start') && has('b.start'));
    expect(a.err()).not.toContain('disk');
  }, 20_000);

  it('below the threshold the effective K is 1 and the reason is printed once', async () => {
    start('--e2e', 'a', '4');
    await until(() => has('a.start'));
    const b = start('--e2e', 'b', '4');
    await until(() => b.err().includes('disk guard: 4 GB free (under 6 GB), e2e slots lowered to 1'));
    await settle();
    expect(has('b.start')).toBe(false);
    expect(b.err().match(/disk guard/g)).toHaveLength(1);
    writeFileSync(join(dir, 'a.go'), '');
    await until(() => has('b.start'));
  }, 20_000);

  it('under half the threshold nothing starts and the gate says it waits for disk', async () => {
    const a = start('--e2e', 'a', '2');
    await until(() => a.err().includes('waiting for disk: 2 GB free'));
    await settle();
    expect(has('a.start')).toBe(false);
  }, 20_000);

  it('stale slot labels (no live lock) never block: the gate still runs, also with the guard at K=1', async () => {
    mkdirSync(join(dir, 'slots'));
    for (const f of ['eslot.1', 'eslot.2', 'lslot.1', 'lslot.2', 'slot.1', 'slot.2'])
      writeFileSync(join(dir, 'slots', f), '99999 1 old\n');
    start('--e2e', 'b', '4');
    await until(() => has('b.start'));
    start('--e2e', 'a', '20');
    start('--light', 'l', '20');
    await until(() => has('a.start') && has('l.start'));
  }, 20_000);

  it('the light pool ignores a full disk', async () => {
    start('--light', 'l', '0');
    await until(() => has('l.start'));
  }, 20_000);
});
