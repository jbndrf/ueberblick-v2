import { spawnSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_FACTOR,
  DOC_BUDGETS,
  defineBudget,
  docBudget,
  evaluate,
  formatLine,
  HARD_FACTOR,
  loadLimit,
  machineLoad,
  verdictOf,
} from './budget.mjs';
import { docRows, renderRows } from './rows.mjs';
import { summarise } from './summary.mjs';

const root = resolve(import.meta.dirname, '../..');

function runCli(
  fixture: string | string[],
  load = '0.1',
  args: string[] = [],
  env: Record<string, string> = {},
) {
  const fixtures = Array.isArray(fixture) ? fixture : [fixture];
  const dir = mkdtempSync(join(tmpdir(), 'bench-harness-'));
  const config = join(dir, 'vitest.config.mjs');
  writeFileSync(
    config,
    `export default { root: ${JSON.stringify(root)}, test: { include: ${JSON.stringify(
      fixtures.map((f) => `bench/harness/fixtures/${f}.fake.ts`),
    )} } };`,
  );
  const outDir = join(dir, 'out');
  const res = spawnSync(
    'node',
    ['bench/harness/cli.mjs', '--config', config, '--out-dir', outDir, '--date', '2026-01-02', ...args],
    { cwd: root, encoding: 'utf8', env: { ...process.env, BENCH_LOAD_PER_CORE: load, ...env } },
  );
  return { res, outDir };
}

describe('budget evaluation', () => {
  it('passes at or below the limit and fails above it', () => {
    const b = defineBudget({ id: 'x', limit: 100, unit: 'ms', derivedFrom: 'test', device: 'server' });
    expect(evaluate(b, 100).pass).toBe(true);
    expect(evaluate(b, 100.5).pass).toBe(false);
  });

  it('formats one line with id, value, limit and verdict', () => {
    const b = defineBudget({ id: 'x', limit: 100, unit: 'ms', derivedFrom: 'test', device: 'server' });
    expect(formatLine(evaluate(b, 40))).toBe('bench x: 40 ms / 100 ms  PASS  [server]');
    expect(formatLine(evaluate(b, 250))).toContain('FAIL');
  });

  it('matches every row of the budget table in docs/12 (id, limit, unit)', () => {
    const areaToId: Record<string, string> = {
      'Participant shell JS': 'shell-js-gzip',
      'Cold start': 'cold-start-60k',
      'Warm start': 'warm-start-map',
      'Main-thread long task': 'long-task',
      'Interaction to next paint': 'interaction-to-next-paint',
      'JS heap': 'heap-60k',
      'Delta visible': 'delta-visible',
      'Full offline copy': 'offline-copy-60k',
      'Server idle RSS': 'server-idle-rss',
      'Run endpoint p95': 'run-endpoint-p95',
      'Empty delta p95': 'empty-delta-p95',
      'Snapshot of 60k': 'snapshot-60k',
      'Viewport/bbox query': 'bbox-query-p95',
      'Filter change': 'filter-change-60k',
    };
    const rows = readFileSync(join(root, 'docs/12-performance-budgets.md'), 'utf8')
      .split('\n')
      .filter((l) => /^\| (?!Area|---)/.test(l))
      .map((l) => l.split('|').map((c) => c.trim()));
    expect(rows).toHaveLength(Object.keys(DOC_BUDGETS).length);
    for (const [, area = '', budget = ''] of rows) {
      const key = Object.keys(areaToId).find((k) => area.startsWith(k));
      expect(key, `no id for table row "${area}"`).toBeDefined();
      const id = areaToId[key ?? ''] ?? '';
      const m = /≤\s*([\d.]+)\s*(KB|MB|ms|s)\b/.exec(budget);
      expect(m, `no limit in "${budget}"`).not.toBeNull();
      expect(DOC_BUDGETS[id]).toMatchObject({ id, row: id, limit: Number(m?.[1]), unit: m?.[2] });
    }
  });

  it('summarise flags a breach and keeps the last value per id', () => {
    const ms = { device: 'server' as const };
    const s = summarise([
      { ...ms, id: 'a', value: 5, limit: 10, unit: 'ms' },
      { ...ms, id: 'a', value: 50, limit: 10, unit: 'ms' },
      { ...ms, id: 'b', value: 1, limit: 10, unit: 'ms' },
    ]);
    expect(s.lines.map((l) => [l.id, l.pass])).toEqual([
      ['a', false],
      ['b', true],
    ]);
    expect(s.ok).toBe(false);
  });
});

describe('budget accounting (device factor, rows)', () => {
  const device = defineBudget({
    id: 'd',
    limit: 100,
    unit: 'ms',
    derivedFrom: 'test',
    device: 'x4',
    thread: 'worker',
  });

  it('needs a docs/12 row or a derivation, and a known device', () => {
    expect(() => defineBudget({ id: 'a', limit: 1, unit: 'ms', device: 'server' })).toThrow(
      /row or derivedFrom/,
    );
    expect(() => defineBudget({ id: 'a', limit: 1, unit: 'ms', row: 'nope', device: 'server' })).toThrow(
      /docs\/12 row/,
    );
    expect(() =>
      defineBudget({ id: 'a', limit: 1, unit: 'ms', derivedFrom: 'x', device: 'phone' as never }),
    ).toThrow(/device/);
    expect(() => defineBudget({ id: 'a', limit: 1, unit: 'ms', derivedFrom: 'x', device: 'x4' })).toThrow(
      /thread/,
    );
  });

  it('compares a device row after the x4 factor and keeps the raw value', () => {
    const ok = evaluate(device, 25);
    expect(ok).toMatchObject({ value: 25, adjusted: 25 * DEVICE_FACTOR, pass: true });
    const bad = evaluate(device, 26);
    expect(bad).toMatchObject({ value: 26, adjusted: 104, pass: false });
    expect(formatLine(bad)).toBe('bench d: 26 ms (x4: 104 ms) / 100 ms  FAIL  [x4, worker]');
  });

  it('does not scale sizes, memory, server or dev-only values', () => {
    const size = defineBudget({
      id: 's',
      limit: 10,
      unit: 'KB',
      derivedFrom: 't',
      device: 'x4',
      thread: 'n/a',
    });
    expect(evaluate(size, 9).adjusted).toBe(9);
    for (const device of ['server', 'dev-only', 'measured'] as const) {
      const b = defineBudget({ id: 'z', limit: 10, unit: 'ms', derivedFrom: 't', device });
      expect(evaluate(b, 9).adjusted).toBe(9);
    }
  });

  it('docBudget takes a docs/12 row and overrides how it is measured', () => {
    const b = docBudget('long-task', { device: 'x4', thread: 'main' });
    expect(b).toMatchObject({ id: 'long-task', row: 'long-task', limit: 100, device: 'x4' });
    expect(DOC_BUDGETS['long-task']?.device).toBe('measured');
  });

  it('summarise keeps the adjustment when it re-evaluates', () => {
    const s = summarise([{ ...device, value: 30 }]);
    expect(s.lines[0]).toMatchObject({ adjusted: 120, pass: false });
    expect(s.ok).toBe(false);
  });

  it('lists every docs/12 row with its worst adjusted value or "unmeasured"', () => {
    const lt = docBudget('long-task', { device: 'x4', thread: 'main' });
    const lines = [
      { ...lt, value: 4, adjusted: 16, pass: true },
      { ...lt, id: 'other', value: 10, adjusted: 40, pass: true },
      { ...device, id: 'derived', derivedFrom: 'cold-start-60k', value: 1, adjusted: 4, pass: true },
    ];
    const rows = docRows(lines);
    expect(rows).toHaveLength(Object.keys(DOC_BUDGETS).length);
    expect(rows.find((r) => r.row === 'long-task')).toMatchObject({ adjusted: 40, limit: 100, sources: 2 });
    expect(rows.find((r) => r.row === 'cold-start-60k')).toMatchObject({
      adjusted: undefined,
      sources: 0,
      derived: 1,
    });
    const text = renderRows(rows);
    expect(text).toContain('unmeasured');
    expect(text).toMatch(/long-task\s+40 ms/);
  });
});

describe('npm run bench (cli)', () => {
  it('prints each budget line and exits 0 when all pass', () => {
    const { res, outDir } = runCli('pass');
    expect(res.stdout).toContain('bench fake-pass: 40 ms / 100 ms  PASS  [server]');
    expect(res.stdout).toContain('docs/12 rows');
    expect(res.stdout).toContain('unmeasured');
    expect(res.status).toBe(0);
    const file = readdirSync(outDir).find((f) => f.endsWith('.json')) ?? '';
    const json = JSON.parse(readFileSync(join(outDir, file), 'utf8'));
    expect(json.date).toBe('2026-01-02');
    expect(json.lines[0]).toMatchObject({ id: 'fake-pass', value: 40, adjusted: 40, limit: 100, pass: true });
    expect(json.rows).toHaveLength(Object.keys(DOC_BUDGETS).length);
  });

  it('runs only the bench files matching a positional filter', () => {
    const { res } = runCli(['pass', 'breach'], '0.1', ['pass']);
    expect(res.stdout).toContain('bench fake-pass:');
    expect(res.stdout).not.toContain('bench fake-breach:');
    expect(res.status).toBe(0);
  });

  it('refuses a filter that matches no bench file, and accepts a path', () => {
    const none = spawnSync('node', ['bench/harness/cli.mjs', 'no-such-bench'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(none.status).toBe(64);
    expect(none.stderr).toContain('no bench file matches no-such-bench');
    const { res } = runCli(['pass', 'breach'], '0.1', ['bench/harness/fixtures/pass']);
    expect(res.stdout).toContain('bench fake-pass:');
    expect(res.stdout).not.toContain('bench fake-breach:');
  });

  it('exits non-zero when a budget is exceeded', () => {
    const { res } = runCli('breach');
    expect(res.stdout).toContain('bench fake-breach: 250 ms / 100 ms  FAIL  [server]');
    expect(res.status).not.toBe(0);
  });
});

describe('every benchmark reports its budget line', () => {
  const benches = globSync('bench/**/*.bench.ts', { cwd: root });

  it('finds the benchmarks', () => {
    expect(benches.length).toBeGreaterThanOrEqual(7);
  });

  it.each(benches)('%s calls report(...) with a budget', (file) => {
    const src = readFileSync(join(root, file), 'utf8');
    expect(src).toMatch(/from '\.\.\/harness\/budget\.mjs'/);
    expect(src).toMatch(/\breport\(/);
  });

  it('every budget names its docs/12 row or its derivation (also the browser scenarios)', () => {
    const files = [...benches, 'bench/browser/scenarios.mjs'];
    let defined = 0;
    for (const file of files) {
      const src = readFileSync(join(root, file), 'utf8');
      for (const m of src.matchAll(/defineBudget\(\{([^}]*)\}\)/gs)) {
        defined++;
        expect(m[1], `${file}: ${m[1]?.slice(0, 40)}`).toMatch(/\b(row|derivedFrom):/);
        expect(m[1], `${file}: device missing`).toMatch(/\bdevice:/);
      }
      expect(src, `${file}: positional defineBudget(id, limit, unit)`).not.toMatch(/defineBudget\(\s*['"]/);
    }
    expect(defined).toBeGreaterThan(20);
  });
});

describe('npm run check runs the harness tests', () => {
  it('check calls bench:harness, which excludes the heavy generator spec', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check']).toContain('bench:harness');
    expect(pkg.scripts['bench:harness']).toContain('bench/harness');
    expect(pkg.scripts['bench:harness']).not.toContain('generate');
  });
});

describe('load is kept apart from failure (WP-153)', () => {
  const b = { id: 'l', limit: 10, unit: 'ms', derivedFrom: 'harness test', device: 'server' } as const;
  const budget = defineBudget(b);

  it('a breach at a busy machine is unreliable, at a quiet one it is a failure', () => {
    expect(verdictOf(evaluate(budget, 15), 0.1)).toBe('FAIL');
    expect(verdictOf(evaluate(budget, 15), loadLimit() + 0.01)).toBe('UNRELIABLE');
    expect(verdictOf(evaluate(budget, 5), 5)).toBe('PASS'); // a pass stays a pass at any load
  });

  it('a size line is judged regardless of load: bytes do not depend on it (WP-858)', () => {
    const size = defineBudget({ id: 's', limit: 29, unit: 'KB', derivedFrom: 'harness test', device: 'measured' });
    expect(verdictOf(evaluate(size, 30.3), loadLimit() + 1)).toBe('FAIL');
    expect(verdictOf(evaluate(size, 28), loadLimit() + 1)).toBe('PASS');
  });

  it('reads the load per core, and a test can pin it', () => {
    const old = process.env.BENCH_LOAD_PER_CORE;
    process.env.BENCH_LOAD_PER_CORE = '0.7';
    expect(machineLoad()).toBe(0.7);
    delete process.env.BENCH_LOAD_PER_CORE;
    expect(machineLoad()).toBeGreaterThanOrEqual(0);
    if (old !== undefined) process.env.BENCH_LOAD_PER_CORE = old;
  });

  it('summarise: an unreliable breach does not fail the run, a quiet one does', () => {
    const busy = summarise([{ ...b, value: 15, load: 1.2 }]);
    expect(busy.ok).toBe(true);
    expect(busy.lines[0]).toMatchObject({ pass: false, load: 1.2 });
    const quiet = summarise([{ ...b, value: 15, load: 0.1 }]);
    expect(quiet.ok).toBe(false);
  });

  it('formats the load and the verdict UNRELIABLE', () => {
    const line = { ...evaluate(budget, 15), load: 1.2 };
    expect(formatLine(line)).toContain('UNRELIABLE');
    expect(formatLine(line)).toContain('load 1.2/core');
    expect(formatLine({ ...evaluate(budget, 5), load: 0.1 })).toContain('PASS');
  });

  it('cli: a breach on a busy machine exits 0 and says why; on a quiet one it exits non-zero', () => {
    const busy = runCli('soft', '1.5');
    expect(busy.res.stdout).toContain('UNRELIABLE');
    expect(busy.res.status).toBe(0);
    const file = readdirSync(busy.outDir).find((f) => f.endsWith('.json')) ?? '';
    const json = JSON.parse(readFileSync(join(busy.outDir, file), 'utf8'));
    expect(json.ok).toBe(true);
    expect(json.lines[0]).toMatchObject({ id: 'fake-soft', pass: false, load: 1.5 });
    expect(runCli('soft', '0.1').res.status).not.toBe(0);
  });

  it('a breach above HARD_FACTOR x the budget fails at any load', () => {
    expect(HARD_FACTOR).toBe(2);
    expect(verdictOf(evaluate(budget, 10 * HARD_FACTOR + 1), 1.5)).toBe('FAIL');
    expect(verdictOf(evaluate(budget, 10 * HARD_FACTOR), 1.5)).toBe('UNRELIABLE');
    expect(summarise([{ ...b, value: 30, load: 1.5 }]).ok).toBe(false);
  });

  it('strict mode counts UNRELIABLE as FAIL', () => {
    expect(verdictOf(evaluate(budget, 15), 1.5, true)).toBe('FAIL');
    expect(summarise([{ ...b, value: 15, load: 1.5 }], true).ok).toBe(false);
    expect(summarise([{ ...b, value: 15, load: 1.5 }]).ok).toBe(true);
  });

  it('cli: a 3x breach at load 1.5 exits non-zero', () => {
    expect(runCli('hard', '1.5').res.status).not.toBe(0);
  });

  it('cli: --strict and BENCH_STRICT=1 fail an UNRELIABLE run; the summary re-lists it', () => {
    expect(runCli('soft', '1.5', ['--strict']).res.status).not.toBe(0);
    expect(runCli('soft', '1.5', [], { BENCH_STRICT: '1' }).res.status).not.toBe(0);
    const busy = runCli('soft', '1.5');
    expect(busy.res.stdout).toContain('UNRELIABLE lines');
    expect(busy.res.stdout.split('fake-soft').length).toBeGreaterThanOrEqual(3);
  });
});
