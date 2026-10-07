// Tests for the light pool of the check gate (WP-905). Stub commands only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { specEnv } from '../testing/spec-env.mjs';

const GATE = resolve(__dirname, 'check-gate.sh');
let dir: string;
let kids: ChildProcess[] = [];

const env = (extra: Record<string, string> = {}) =>
  specEnv({
    UEB_CHECK_DIR: join(dir, 'slots'),
    UEB_CHECK_SLOTS: '2',
    ...extra,
  });
const gate = (name: string, extra: Record<string, string> = {}) => {
  const stub = `touch ${dir}/${name}.start; while [ ! -e ${dir}/${name}.go ]; do sleep 0.05; done; touch ${dir}/${name}.end`;
  const c = spawn('bash', [GATE, 'bash', '-c', stub], {
    env: env(extra),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  c.stderr?.on('data', (d) => (err += d));
  kids.push(c);
  return { c, err: () => err };
};
const until = async (f: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
};
const has = (f: string) => existsSync(join(dir, f));
const release = (name: string) => writeFileSync(join(dir, `${name}.go`), '');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gate-'));
});
afterEach(() => {
  for (const k of kids) k.kill('SIGKILL');
  kids = [];
  rmSync(dir, { recursive: true, force: true });
});

describe('check-gate light pool (WP-905)', () => {
  const light = (name: string, extra: Record<string, string> = {}, flag = ['--light']) => {
    const stub = `touch ${dir}/${name}.start; while [ ! -e ${dir}/${name}.go ]; do sleep 0.05; done; touch ${dir}/${name}.end`;
    const c = spawn('bash', [GATE, ...flag, 'bash', '-c', stub], {
      env: env({ UEB_LIGHT_SLOTS: '1', ...extra }),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    c.stderr?.on('data', (d) => (err += d));
    kids.push(c);
    return { c, err: () => err };
  };
  /** Like scoped(), but it holds until released, so two of them overlap. */
  const scopedHold = (name: string) => {
    const stub = `touch ${dir}/${name}.start; while [ ! -e ${dir}/${name}.go ]; do sleep 0.05; done; touch ${dir}/${name}.end`;
    const c = spawn('bash', [GATE, '--scoped-after', '3', 'bash', '-c', stub, '-x', 'a/b.spec.ts'], {
      env: env({ UEB_LIGHT_SLOTS: '1', UEB_CHECK_SLOTS: '1' }),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    c.stderr?.on('data', (d) => (err += d));
    kids.push(c);
    return { c, err: () => err };
  };

  it('with one light slot two scoped runs serialise, while a full check runs in parallel', async () => {
    scopedHold('s1');
    await until(() => has('s1.start'));
    const s2 = scopedHold('s2');
    await until(() => s2.err().includes('waiting for a light slot'));
    expect(has('s2.start')).toBe(false);
    gate('f', { UEB_CHECK_SLOTS: '1' });
    await until(() => has('f.start'));
    release('s1');
    await until(() => has('s2.start'));
  }, 20_000);

  it('a full holder does not block the light pool, and a light holder does not block the full pool', async () => {
    gate('f', { UEB_CHECK_SLOTS: '1' });
    light('l');
    await until(() => has('f.start') && has('l.start'));
  }, 20_000);

  it('a light command under a full slot (check:fast inside check) takes no light slot', async () => {
    light('l');
    await until(() => has('l.start'));
    const stub = `bash ${GATE} --light bash -c 'touch ${dir}/inner'; touch ${dir}/outer.end`;
    spawn('bash', [GATE, 'bash', '-c', stub], {
      env: env({ UEB_CHECK_SLOTS: '1', UEB_LIGHT_SLOTS: '1' }),
      stdio: 'ignore',
    });
    await until(() => has('outer.end'), 10_000);
    expect(has('inner')).toBe(true);
  }, 20_000);

  it('standalone check:fast (pre-commit) takes a light slot and waits when it is held', async () => {
    light('l');
    await until(() => has('l.start'));
    const b = light('b');
    await until(() => b.err().includes('waiting for a light slot (1 running), queue position 1'));
    expect(has('b.start')).toBe(false);
    release('l');
    await until(() => has('b.start'));
  }, 20_000);

  it('a light holder under a light slot does not cover a nested full command', async () => {
    const stub = `bash ${GATE} bash -c 'touch ${dir}/inner'`;
    const g = spawn('bash', [GATE, '--light', 'bash', '-c', stub], {
      env: env({ UEB_CHECK_SLOTS: '1', UEB_LIGHT_SLOTS: '1' }),
      stdio: 'ignore',
    });
    kids.push(g);
    // the nested full command takes a full slot of its own (free here), so it runs
    await until(() => has('inner'), 10_000);
  }, 20_000);

  it.each(['SIGTERM', 'SIGKILL'] as const)(
    'a light holder killed by %s frees its slot',
    async (sig) => {
      const a = light('a');
      await until(() => has('a.start'));
      light('b');
      await new Promise((r) => setTimeout(r, 300));
      expect(has('b.start')).toBe(false);
      a.c.kill(sig);
      await until(() => has('b.start'));
    },
    20_000,
  );

  it('land bypasses both pools while they are full', async () => {
    gate('f', { UEB_CHECK_SLOTS: '1' });
    light('l');
    await until(() => has('f.start') && has('l.start'));
    gate('land', { UEB_LOCKED: '1' });
    await until(() => has('land.start'));
    release('land');
    await until(() => has('land.end'));
  }, 20_000);

  it('the light default is max(4, nproc/8) slots', async () => {
    const cores = Number(spawnSync('nproc', { encoding: 'utf8', env: specEnv() }).stdout.trim());
    const n = Math.max(4, Math.floor(cores / 8));
    const names = Array.from({ length: n }, (_, i) => `d${i}`);
    for (const x of names) light(x, { UEB_LIGHT_SLOTS: '' });
    await until(() => names.every((x) => has(`${x}.start`)));
    const e = light('e', { UEB_LIGHT_SLOTS: '' });
    await until(() => e.err().includes(`(${n} running)`));
    expect(has('e.start')).toBe(false);
  }, 30_000);

  it('rejects a bad UEB_LIGHT_SLOTS', () => {
    const r = spawnSync('bash', [GATE, '--light', 'true'], {
      env: env({ UEB_LIGHT_SLOTS: 'x' }),
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
  });
});
