import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, evaluate, HARD_FACTOR } from './budget.mjs';

const root = resolve(import.meta.dirname, '../..');

function runCli(fixture: string, load: string, args: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-assert-'));
  const config = join(dir, 'vitest.config.mjs');
  writeFileSync(
    config,
    `export default { root: ${JSON.stringify(root)}, test: { include: [${JSON.stringify(
      `bench/harness/fixtures/${fixture}.fake.ts`,
    )}] } };`,
  );
  return spawnSync(
    'node',
    [
      'bench/harness/cli.mjs',
      '--config',
      config,
      '--out-dir',
      join(dir, 'out'),
      '--date',
      '2026-01-02',
      ...args,
    ],
    { cwd: root, encoding: 'utf8', env: { ...process.env, BENCH_LOAD_PER_CORE: load } },
  );
}

describe('assertBudget judges through the load-aware verdict (WP-913)', () => {
  const budget = defineBudget({
    id: 'a',
    limit: 10,
    unit: 'ms',
    derivedFrom: 'harness test',
    device: 'server',
  });
  const at = (value: number, load: number) => ({ ...evaluate(budget, value), load });

  it('passes under budget at any load', () => {
    expect(assertBudget(at(5, 0.1), false)).toBe('PASS');
    expect(assertBudget(at(5, 3), true)).toBe('PASS');
  });
  it('over budget at high load is UNRELIABLE and does not throw', () => {
    expect(assertBudget(at(15, 1.2), false)).toBe('UNRELIABLE');
  });
  it('over budget on a quiet machine throws, with the line in the message', () => {
    expect(() => assertBudget(at(15, 0.1), false)).toThrow(/budget exceeded: bench a: 15 ms/);
  });
  it('strict throws for UNRELIABLE, and BENCH_STRICT=1 is the default source', () => {
    expect(() => assertBudget(at(15, 1.2), true)).toThrow(/budget exceeded/);
    const old = process.env.BENCH_STRICT;
    process.env.BENCH_STRICT = '1';
    expect(() => assertBudget(at(15, 1.2))).toThrow(/budget exceeded/);
    delete process.env.BENCH_STRICT;
    expect(assertBudget(at(15, 1.2))).toBe('UNRELIABLE');
    if (old !== undefined) process.env.BENCH_STRICT = old;
  });
  it('over HARD_FACTOR x the limit throws at any load', () => {
    expect(() => assertBudget(at(10 * HARD_FACTOR + 1, 5), false)).toThrow(/budget exceeded/);
    expect(assertBudget(at(10 * HARD_FACTOR, 5), false)).toBe('UNRELIABLE');
  });
  it('cli: an UNRELIABLE-only bench exits 0 at load 1.5 (the bench process does not fail)', () => {
    const busy = runCli('assert-soft', '1.5');
    expect(busy.status).toBe(0);
    expect(busy.stdout).toContain('UNRELIABLE');
  });
  it('cli: the same bench fails quiet, under --strict and over HARD_FACTOR', () => {
    expect(runCli('assert-soft', '0.1').status).not.toBe(0);
    expect(runCli('assert-soft', '1.5', ['--strict']).status).not.toBe(0);
    expect(runCli('assert-hard', '1.5').status).not.toBe(0);
  });
});
