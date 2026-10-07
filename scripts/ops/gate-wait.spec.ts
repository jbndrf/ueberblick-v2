import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gateWaitField } from '../metrics/lib.mjs';
import { specEnv } from '../testing/spec-env.mjs';

// WP-953: the time a run queued for its check slot reaches the records as gateWaitMs.
const GATE = resolve(__dirname, 'check-gate.sh');
const STEPS = resolve(__dirname, 'steps.mjs');
const RECORD = resolve(__dirname, '../metrics/test-record.mjs');
const root = resolve(__dirname, '../..');
let dir: string;
let kids: ChildProcess[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gatewait-'));
});
afterEach(() => {
  for (const k of kids) k.kill('SIGKILL');
  kids = [];
  rmSync(dir, { recursive: true, force: true });
});

const jsonl = (f: string): Array<Record<string, unknown>> =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('gateWaitField', () => {
  it('reads UEB_GATE_WAIT_MS and ignores absent or invalid values', () => {
    expect(gateWaitField({ UEB_GATE_WAIT_MS: '1234' })).toEqual({ gateWaitMs: 1234 });
    expect(gateWaitField({ UEB_GATE_WAIT_MS: '0' })).toEqual({ gateWaitMs: 0 });
    expect(gateWaitField({})).toEqual({});
    expect(gateWaitField({ UEB_GATE_WAIT_MS: '' })).toEqual({});
    expect(gateWaitField({ UEB_GATE_WAIT_MS: 'x' })).toEqual({});
    expect(gateWaitField({ UEB_GATE_WAIT_MS: '-5' })).toEqual({});
  });
});

describe('check-gate exports the wait', () => {
  it('a run that got its slot at once waits about nothing, a queued one waits for the holder', async () => {
    const env = specEnv({ UEB_CHECK_DIR: join(dir, 'slots'), UEB_CHECK_SLOTS: '1' });
    const holder = spawn(
      'bash',
      [GATE, 'bash', '-c', `touch ${dir}/held; while [ ! -e ${dir}/go ]; do sleep 0.05; done`],
      { env, stdio: 'ignore' },
    );
    kids.push(holder);
    while (!existsSync(join(dir, 'held'))) await new Promise((r) => setTimeout(r, 30));
    const waiter = spawn('bash', [GATE, 'bash', '-c', `echo "$UEB_GATE_WAIT_MS" >${dir}/wait`], {
      env,
      stdio: 'ignore',
    });
    kids.push(waiter);
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(join(dir, 'go'), '');
    await new Promise((r) => waiter.on('close', r));
    const waited = Number(readFileSync(join(dir, 'wait'), 'utf8'));
    expect(waited).toBeGreaterThanOrEqual(1000);
    expect(waited).toBeLessThan(15_000);
  }, 30_000);

  it('an uncontended run reports a small wait', () => {
    const r = spawnSync('bash', [GATE, 'bash', '-c', 'echo "$UEB_GATE_WAIT_MS"'], {
      encoding: 'utf8',
      env: specEnv({ UEB_CHECK_DIR: join(dir, 'slots'), UEB_CHECK_SLOTS: '1' }),
    });
    expect(r.status).toBe(0);
    expect(Number(r.stdout.trim())).toBeLessThan(3000);
  });
});

describe('records carry gateWaitMs', () => {
  it('steps.mjs writes it to check-steps.jsonl', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'f', private: true, scripts: { ok: 'node -e "process.exit(0)"' } }),
    );
    const out = join(dir, 'out');
    const r = spawnSync('node', [STEPS, 'waitsuite', 'ok'], {
      cwd: dir,
      encoding: 'utf8',
      env: specEnv({ UB_NO_RECORD: '', UEB_STEPS_OUT: out, UEB_GATE_WAIT_MS: '4321' }),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(jsonl(join(out, 'check-steps.jsonl')).at(-1)).toMatchObject({
      suite: 'waitsuite',
      gateWaitMs: 4321,
    });
  }, 30_000);

  it('test-record.mjs writes it to tests.jsonl', () => {
    const out = join(dir, 'out');
    const r = spawnSync('node', [RECORD, 'scripts/ops/tmpleak.fixture.spec.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: specEnv({ UB_NO_RECORD: '', UEB_RECORD_OUT: out, UEB_GATE_WAIT_MS: '777' }),
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(jsonl(join(out, 'tests.jsonl')).at(-1)).toMatchObject({ gateWaitMs: 777, exitCode: 0 });
  }, 120_000);
});
