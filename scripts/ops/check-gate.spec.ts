// Tests for the check concurrency gate (WP-140). Stub commands only, no real check runs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    // the e2e disk guard must not read the host's real free space (red under 10 GB free, 2026-10-04)
    UEB_E2E_FREE_GB: '100',
    ...extra,
  });
/** Starts the gate around a stub that writes <name>.start, waits for <name>.go, then writes <name>.end. */
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
/** Like gate(), with the scoped flag: the stub is the 3 fixed command words, `args` are what `npm test -- ...` appends. */
const scoped = (name: string, args: string[]) => {
  const stub = `touch ${dir}/${name}.start; touch ${dir}/${name}.end`;
  const c = spawn('bash', [GATE, '--scoped-after', '3', 'bash', '-c', stub, '-x', ...args], {
    env: env({ UEB_CHECK_SLOTS: '1' }),
    stdio: 'ignore',
  });
  kids.push(c);
  return c;
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

describe('check-gate', () => {
  it('with K=2 a third gated command waits until one finishes', async () => {
    gate('a');
    gate('b');
    await until(() => has('a.start') && has('b.start'));
    const c = gate('c');
    await until(() => c.err().includes('waiting for a check slot (2 running), queue position 1'));
    expect(has('c.start')).toBe(false);
    release('a');
    await until(() => has('c.start'));
    release('b');
    release('c');
    await until(() => has('c.end') && has('b.end'));
  }, 20_000);

  it('a land-mode run gets the reserved slot while both agent slots are busy', async () => {
    gate('a');
    gate('b');
    await until(() => has('a.start') && has('b.start'));
    gate('l', { UEB_LOCKED: '1' });
    await until(() => has('l.start'));
    release('l');
    await until(() => has('l.end'));
  }, 20_000);

  it('a second land-mode run waits for the first', async () => {
    gate('l1', { UEB_LOCKED: '1' });
    await until(() => has('l1.start'));
    gate('l2', { UEB_LOCKED: '1' });
    await new Promise((r) => setTimeout(r, 400));
    expect(has('l2.start')).toBe(false);
    release('l1');
    await until(() => has('l2.start'));
  }, 20_000);

  it.each(['SIGTERM', 'SIGKILL'] as const)(
    'a holder killed by %s frees its slot',
    async (sig) => {
      const a = gate('a', { UEB_CHECK_SLOTS: '1' });
      await until(() => has('a.start'));
      gate('b', { UEB_CHECK_SLOTS: '1' });
      await new Promise((r) => setTimeout(r, 300));
      expect(has('b.start')).toBe(false);
      a.c.kill(sig);
      await until(() => has('b.start'));
    },
    20_000,
  );

  it('reports the wait and the holders every interval', async () => {
    gate('a', { UEB_CHECK_SLOTS: '1' });
    await until(() => has('a.start'));
    const b = gate('b', { UEB_CHECK_SLOTS: '1', UEB_CHECK_REPORT_SECS: '1' });
    await until(() =>
      /waiting \d+ s for a check slot \(position 1\); holders: pid \d+ \(0 min\)/.test(b.err()),
    );
  }, 20_000);

  it("passes the command's exit code through, and a broken gate is never a pass", () => {
    const run = (extra: Record<string, string>, ...cmd: string[]) =>
      spawnSync('bash', [GATE, ...cmd], { env: env(extra), encoding: 'utf8' });
    expect(run({}, 'bash', '-c', 'exit 7').status).toBe(7);
    expect(run({ UEB_CHECK_SLOTS: 'x' }, 'true').status).toBe(2);
    expect(run({ UEB_CHECK_DIR: '/proc/nope/slots' }, 'true').status).not.toBe(0);
    expect(run({}).status).toBe(2);
  });

  it('a command already under a gate does not take a second slot', () => {
    const r = spawnSync('bash', [GATE, 'bash', GATE, 'bash', '-c', 'echo inner'], {
      env: env({ UEB_CHECK_SLOTS: '1' }),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(r.stdout.trim()).toBe('inner');
  });

  it('with every slot held, a run with a path argument starts at once; one without a path waits', async () => {
    gate('a', { UEB_CHECK_SLOTS: '1' });
    await until(() => has('a.start'));
    scoped('p', ['packages/core/src/expr/x.spec.ts']);
    await until(() => has('p.end'));
    scoped('o', ['--reporter=dot']);
    scoped('q', []);
    await new Promise((r) => setTimeout(r, 500));
    expect(has('o.start') || has('q.start')).toBe(false);
    release('a');
    await until(() => has('o.end') && has('q.end'));
  }, 20_000);

  it('a scoped run needs the gate directory too: the gate never skips', () => {
    const run = (...cmd: string[]) =>
      spawnSync('bash', [GATE, ...cmd], {
        env: env({ UEB_CHECK_DIR: '/proc/nope/slots' }),
        encoding: 'utf8',
      });
    expect(run('--scoped-after', '1', 'echo', 'a/path').status).not.toBe(0);
    expect(run('--scoped-after', '1', 'echo').status).not.toBe(0);
  });

  it('wires only npm test as scoped, and npm run check stays gated without the flag', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).scripts;
    expect(pkg.test).toMatch(/check-gate\.sh --scoped-after 3 node scripts\/ops\/vitest-scoped\.mjs run$/);
    expect(pkg.check).not.toContain('--scoped-after');
  });

  it('gates npm run check and npm test; check:fast takes only a light slot', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).scripts;
    expect(pkg.check).toContain('check-gate.sh');
    expect(pkg.test).toContain('check-gate.sh');
    expect(pkg['check:fast']).toMatch(/check-gate\.sh --light npm run check:fast:run$/);
    expect(pkg['check:fast:run']).not.toContain('check-gate');
    expect(pkg['deps:install']).toMatch(/check-gate\.sh --light node scripts\/ops\/deps-install\.mjs/);
    expect(pkg.check).toContain('check:fast');
  });
});

describe('check-gate fairness and no bypass (WP-140.2)', () => {
  const arrive = async (name: string, extra: Record<string, string> = {}) => {
    const g = gate(name, { UEB_CHECK_SLOTS: '1', ...extra });
    await until(() => g.err().includes('waiting') || has(`${name}.start`));
    return g;
  };

  it('waiters get the slot in arrival order, over 20 release cycles', async () => {
    const order = join(dir, 'order');
    const names = Array.from({ length: 21 }, (_, i) => `w${i}`);
    const spawnOrdered = (name: string) => {
      const stub = `echo ${name} >>${order}; while [ ! -e ${dir}/${name}.go ]; do sleep 0.02; done`;
      const c = spawn('bash', [GATE, 'bash', '-c', stub], {
        env: env({ UEB_CHECK_SLOTS: '1' }),
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      c.stderr?.on('data', (d) => (err += d));
      kids.push(c);
      return () => err;
    };
    for (const n of names) {
      const err = spawnOrdered(n);
      if (n !== 'w0') await until(() => err().includes('queue position'));
      else await until(() => existsSync(order));
    }
    for (const n of names) {
      await until(() => existsSync(order) && readFileSync(order, 'utf8').includes(`${n}\n`), 15_000);
      expect(readFileSync(order, 'utf8').trim().split('\n')).toEqual(names.slice(0, names.indexOf(n) + 1));
      release(n);
    }
  }, 120_000);

  it('reports the queue position of each waiter', async () => {
    gate('a', { UEB_CHECK_SLOTS: '1' });
    await until(() => has('a.start'));
    const b = await arrive('b');
    const c = await arrive('c');
    await until(() => b.err().includes('queue position 1') && c.err().includes('queue position 2'));
  }, 20_000);

  it("a dead waiter's ticket is skipped", async () => {
    gate('a', { UEB_CHECK_SLOTS: '1' });
    await until(() => has('a.start'));
    const b = await arrive('b');
    await arrive('c');
    b.c.kill('SIGKILL');
    release('a');
    await until(() => has('c.start'));
    expect(has('b.start')).toBe(false);
  }, 20_000);

  it.each([['1'], [`slot.1:${process.pid}`], ['slot.1:999999'], ['land.slot:1'], ['../x:1']])(
    'UEB_GATE_HELD=%s set by hand does not bypass: the command queues',
    async (v) => {
      gate('a', { UEB_CHECK_SLOTS: '1' });
      await until(() => has('a.start'));
      const b = gate('b', { UEB_CHECK_SLOTS: '1', UEB_GATE_HELD: v });
      await until(() => b.err().includes('ignoring UEB_GATE_HELD'));
      await new Promise((r) => setTimeout(r, 300));
      expect(has('b.start')).toBe(false);
      release('a');
      await until(() => has('b.start'));
    },
    20_000,
  );

  it('a real nested call takes no second slot even when the queue is not empty', async () => {
    const stub = `bash ${GATE} bash -c 'touch ${dir}/inner'; touch ${dir}/outer.end`;
    spawn('bash', [GATE, 'bash', '-c', stub], { env: env({ UEB_CHECK_SLOTS: '1' }), stdio: 'ignore' });
    await until(() => has('outer.end'), 10_000);
    expect(has('inner')).toBe(true);
  }, 20_000);

  // 6 since 2026-10-03: 5.5 agents waited for one of 4 slots 100% of the time at CPU p50 54% / p90 77% of 64 cores
  // (fleet report); runs split cores and memory by weight (resources.mjs), so more slots share the same budget.
  it('the default is 6 slots', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const n of six) gate(n, { UEB_CHECK_SLOTS: '' });
    await until(() => six.every((n) => has(`${n}.start`)));
    const g = gate('g', { UEB_CHECK_SLOTS: '' });
    await until(() => g.err().includes('(6 running)'));
    expect(has('g.start')).toBe(false);
  }, 20_000);

  // The shared setting: a K change reaches every worktree at once, also those whose script copy predates it
  // (2026-10-03: 14 worktrees still gated at 4 an hour after the default became 6).
  it('<slot dir>/K sets the slot count when UEB_CHECK_SLOTS is unset', async () => {
    mkdirSync(join(dir, 'slots'), { recursive: true });
    writeFileSync(join(dir, 'slots', 'K'), '2\n');
    for (const n of ['a', 'b']) gate(n, { UEB_CHECK_SLOTS: '' });
    await until(() => has('a.start') && has('b.start'));
    const c = gate('c', { UEB_CHECK_SLOTS: '' });
    await until(() => c.err().includes('(2 running)'));
    expect(has('c.start')).toBe(false);
  }, 20_000);

  it.each([[''], ['garbage'], ['12x']])(
    'an unreadable queue counter (%j) is rebuilt and the command runs',
    (content) => {
      mkdirSync(join(dir, 'slots'), { recursive: true });
      writeFileSync(join(dir, 'slots', 'q.count'), content);
      const r = spawnSync('bash', [GATE, 'echo', 'ran'], { env: env(), encoding: 'utf8', timeout: 5000 });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ran');
      expect(r.stderr).toContain('queue counter was unreadable');
      expect(readFileSync(join(dir, 'slots', 'q.count'), 'utf8').trim()).toBe('1');
    },
  );

  it('a rebuilt counter continues after the highest existing ticket', () => {
    mkdirSync(join(dir, 'slots'), { recursive: true });
    writeFileSync(join(dir, 'slots', 'q.count'), '');
    writeFileSync(join(dir, 'slots', 'q.000000000007'), '');
    const r = spawnSync('bash', [GATE, 'true'], { env: env(), encoding: 'utf8', timeout: 5000 });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'slots', 'q.count'), 'utf8').trim()).toBe('8');
  });

  it('the exported land slot works for a nested gated call under land', () => {
    const r = spawnSync('bash', [GATE, 'bash', GATE, 'bash', '-c', 'echo inner'], {
      env: env({ UEB_LOCKED: '1' }),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('inner');
    expect(r.stderr).not.toContain('ignoring');
  });

  it('a land run does not wait behind a queue of agent waiters', async () => {
    gate('a', { UEB_CHECK_SLOTS: '1' });
    await until(() => has('a.start'));
    await arrive('b');
    await arrive('c');
    gate('l', { UEB_LOCKED: '1' });
    await until(() => has('l.start'));
    release('l');
    await until(() => has('l.end'));
    expect(has('b.start') || has('c.start')).toBe(false);
  }, 20_000);

  it('a broken queue is never a pass', () => {
    mkdirSync(join(dir, 'slots', 'q.lock'), { recursive: true });
    const r = spawnSync('bash', [GATE, 'true'], { env: env(), encoding: 'utf8', timeout: 5000 });
    expect(r.status).not.toBe(0);
  });
});

describe('check-gate e2e pool (WP-1016)', () => {
  const e2e = (name: string, extra: Record<string, string> = {}) => {
    const stub = `touch ${dir}/${name}.start; while [ ! -e ${dir}/${name}.go ]; do sleep 0.05; done; touch ${dir}/${name}.end`;
    const c = spawn('bash', [GATE, '--e2e', 'bash', '-c', stub], {
      env: env({ UEB_E2E_SLOTS: '2', UEB_CHECK_SLOTS: '1', ...extra }),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    c.stderr?.on('data', (d) => (err += d));
    kids.push(c);
    return { c, err: () => err };
  };

  it('admits K holders and queues the (K+1)th until one finishes', async () => {
    e2e('a');
    e2e('b');
    await until(() => has('a.start') && has('b.start'));
    const c = e2e('c');
    await until(() => c.err().includes('waiting for a e2e slot (2 running), queue position 1'));
    expect(has('c.start')).toBe(false);
    release('a');
    await until(() => has('c.start'));
  }, 20_000);

  it('is its own pool: full holders do not block it', async () => {
    gate('f', { UEB_CHECK_SLOTS: '1' });
    e2e('e');
    await until(() => has('f.start') && has('e.start'));
  }, 20_000);

  it('K comes from <slot dir>/K.e2e when UEB_E2E_SLOTS is unset', async () => {
    mkdirSync(join(dir, 'slots'), { recursive: true });
    writeFileSync(join(dir, 'slots', 'K.e2e'), '1\n');
    e2e('a', { UEB_E2E_SLOTS: '' });
    await until(() => has('a.start'));
    e2e('b', { UEB_E2E_SLOTS: '' });
    await new Promise((r) => setTimeout(r, 500));
    expect(has('b.start')).toBe(false);
  }, 20_000);

  it('a nested e2e call under a held e2e slot runs without waiting, also with K=1', async () => {
    const stub = `bash ${GATE} --e2e bash -c 'touch ${dir}/inner'`;
    kids.push(
      spawn('bash', [GATE, '--e2e', 'bash', '-c', stub], {
        env: env({ UEB_E2E_SLOTS: '1' }),
        stdio: 'ignore',
      }),
    );
    await until(() => has('inner'), 10_000);
  }, 20_000);

  it('an e2e call under a full slot (a land train) runs without waiting', async () => {
    const stub = `bash ${GATE} --e2e bash -c 'touch ${dir}/inner'`;
    kids.push(
      spawn('bash', [GATE, 'bash', '-c', stub], { env: env({ UEB_E2E_SLOTS: '1' }), stdio: 'ignore' }),
    );
    await until(() => has('inner'), 10_000);
  }, 20_000);

  it('UEB_E2E_SLOTS=0 is rejected', () => {
    const r = spawnSync('bash', [GATE, '--e2e', 'true'], {
      env: env({ UEB_E2E_SLOTS: '0' }),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('UEB_E2E_SLOTS must be a positive integer');
  });
});
