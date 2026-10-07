import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceShards,
  createLimiter,
  defaultShards,
  fileStats,
  mergeHistory,
  mergeReports,
  runShards,
  shardArg,
  shardCount,
  spawnWithRetry,
  hasFileFilters,
  // @ts-expect-error plain .mjs runner without declarations
} from './shards.mjs';

interface Stats {
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  duration: number;
  startTime: string;
}
interface Report {
  suites: { title: string }[];
  errors: unknown[];
  stats: Stats;
}
const merge = mergeReports as (r: Report[]) => Report;
const count = shardCount as (env: Record<string, string>, cores?: number) => number;
const dflt = defaultShards as (cores: number) => number;
const shard = shardArg as (i: number, k: number) => string;
const stats = (expected: number, unexpected: number, duration: number, startTime: string): Stats => ({
  expected,
  unexpected,
  flaky: 0,
  skipped: 1,
  duration,
  startTime,
});

describe('shard count', () => {
  it('defaults to min(4, cores / 8), at least 1', () => {
    expect([dflt(2), dflt(8), dflt(16), dflt(32), dflt(64)]).toEqual([1, 1, 2, 4, 4]);
  });
  it('UEB_E2E_WORKERS wins; 1 forces a plain run; junk falls back to the default', () => {
    expect(count({ UEB_E2E_WORKERS: '3' }, 64)).toBe(3);
    expect(count({ UEB_E2E_WORKERS: '1' }, 64)).toBe(1);
    expect(count({ UEB_E2E_WORKERS: 'x' }, 64)).toBe(4);
    expect(count({ UEB_E2E_WORKERS: '0' }, 64)).toBe(4);
    expect(count({}, 64)).toBe(4);
  });
  it('numbers shards from 1 for Playwright', () => {
    expect(shard(0, 4)).toBe('--shard=1/4');
    expect(shard(3, 4)).toBe('--shard=4/4');
  });
});

describe('mergeReports', () => {
  it('concatenates suites and errors, sums the counts, keeps the longest duration and the first start', () => {
    const a: Report = {
      suites: [{ title: 'a.spec.ts' }],
      errors: [],
      stats: stats(3, 1, 100, '2026-10-03T10:00:02Z'),
    };
    const b: Report = {
      suites: [{ title: 'b.spec.ts' }],
      errors: [{}],
      stats: stats(5, 0, 250, '2026-10-03T10:00:01Z'),
    };
    const m = merge([a, b]);
    expect(m.suites.map((s) => s.title)).toEqual(['a.spec.ts', 'b.spec.ts']);
    expect(m.errors).toHaveLength(1);
    expect(m.stats).toMatchObject({ expected: 8, unexpected: 1, skipped: 2, duration: 250 });
    expect(m.stats.startTime).toBe('2026-10-03T10:00:01Z');
  });
  it('refuses nothing to merge', () => {
    expect(() => merge([])).toThrow();
  });
});

describe('runShards', () => {
  const base = mkdtempSync(join(tmpdir(), 'e2e-shards-spec-'));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const calls: { args: string[]; env: Record<string, string> }[] = [];
  const fake =
    (codes: number[]) => async (args: string[], env: Record<string, string>, _cwd: string, label: string) => {
      const out = env['PLAYWRIGHT_JSON_OUTPUT_NAME'] ?? '';
      const report = {
        suites: [{ title: label }],
        errors: [],
        stats: stats(1, codes[Number(label.slice(6)) - 1] ?? 0, 5, 'x'),
      };
      writeFileSync(out, JSON.stringify(report));
      calls.push({ args, env });
      return { code: codes[Number(label.slice(6)) - 1] ?? 0, portTaken: false };
    };
  const go = async (codes: number[], name: string) => {
    const tmpDir = join(base, name);
    mkdirSync(tmpDir, { recursive: true });
    const reportPath = join(tmpDir, 'out', 'merged.json');
    calls.length = 0;
    const code = await (runShards as (o: unknown) => Promise<number>)({
      config: 'c.ts',
      k: 3,
      shardEnvs: [{ E2E_PORT: '1' }, { E2E_PORT: '2' }, { E2E_PORT: '3' }],
      passthrough: ['-g', 'x'],
      env: { KEEP: 'y' },
      tmpDir,
      reportPath,
      cwd: '/',
      spawnShard: fake(codes),
    });
    return { code, merged: JSON.parse(readFileSync(reportPath, 'utf8')) as Report };
  };
  it('gives each shard its own env and report file, passes the rest through, merges the reports', async () => {
    const { code, merged } = await go([0, 0, 0], 'ok');
    expect(code).toBe(0);
    expect(merged.suites).toHaveLength(3);
    expect(calls.map((c) => c.env['E2E_PORT'])).toEqual(['1', '2', '3']);
    expect(new Set(calls.map((c) => c.env['PLAYWRIGHT_JSON_OUTPUT_NAME'])).size).toBe(3);
    expect(calls.every((c) => c.env['KEEP'] === 'y' && c.args.includes('--pass-with-no-tests'))).toBe(true);
    expect(calls.map((c) => c.args.find((a) => a.startsWith('--shard=')))).toEqual([
      '--shard=1/3',
      '--shard=2/3',
      '--shard=3/3',
    ]);
    expect(calls[0]?.args.slice(-2)).toEqual(['-g', 'x']);
  });
  it('with shardFiles every shard runs exactly its files, gets its env from renewEnv and is limited', async () => {
    const tmpDir = join(base, 'files');
    mkdirSync(tmpDir, { recursive: true });
    calls.length = 0;
    let made = 0;
    const lim = createLimiter(1) as <T>(f: () => Promise<T>) => Promise<T>;
    const code = await (runShards as (o: unknown) => Promise<number>)({
      config: 'c.ts',
      shardFiles: [['a.e2e.ts'], ['sub/b.e2e.ts', 'c.e2e.ts']],
      renewEnv: async () => ({ E2E_PORT: String(++made) }),
      passthrough: [],
      env: {},
      tmpDir,
      reportPath: join(tmpDir, 'merged.json'),
      cwd: '/',
      limit: lim,
      name: 'web',
      spawnShard: fake([0, 0]),
    });
    expect(code).toBe(0);
    expect(calls.map((c) => c.args.some((a) => a.startsWith('--shard=')))).toEqual([false, false]);
    expect(calls[1]?.args.slice(-2)).toEqual(['/sub/b\\.e2e\\.ts$', '/c\\.e2e\\.ts$']);
    expect(calls.map((c) => c.env['E2E_PORT'])).toEqual(['1', '2']);
  });
  it('fails when one shard fails, and still writes the merged report', async () => {
    const { code, merged } = await go([0, 1, 0], 'red');
    expect(code).toBe(1);
    expect(merged.stats.unexpected).toBe(1);
  });
});

describe('spawnWithRetry', () => {
  type R = { code: number; portTaken: boolean };
  const retry = spawnWithRetry as (
    spawn: (a: string[], e: Record<string, string>, c: string, l: string) => Promise<R>,
    args: string[],
    envOf: (attempt: number) => Promise<Record<string, string>>,
    cwd: string,
    label: string,
  ) => Promise<number>;
  it('runs once more with a new env when the server port was taken, and not for other failures', async () => {
    const ports: (string | undefined)[] = [];
    const taken = async (_a: string[], e: Record<string, string>) => {
      ports.push(e['P']);
      return { code: 1, portTaken: ports.length === 1 };
    };
    expect(await retry(taken, [], async (n) => ({ P: `p${n}` }), '/', 'x')).toBe(1);
    expect(ports).toEqual(['p1', 'p2']);
    ports.length = 0;
    const red = async (_a: string[], e: Record<string, string>) => {
      ports.push(e['P']);
      return { code: 1, portTaken: false };
    };
    expect(await retry(red, [], async (n) => ({ P: `p${n}` }), '/', 'x')).toBe(1);
    expect(ports).toEqual(['p1']);
  });
  it('gives up after two tries and passes a green run through', async () => {
    let n = 0;
    const always = async () => ({ code: 1, portTaken: (n++, true) });
    expect(await retry(always, [], async () => ({}), '/', 'x')).toBe(1);
    expect(n).toBe(2);
    expect(
      await retry(
        async () => ({ code: 0, portTaken: false }),
        [],
        async () => ({}),
        '/',
        'x',
      ),
    ).toBe(0);
  });
});

describe('duration balancing (WP-1016)', () => {
  type Rep = { suites: unknown[] };
  const files = (r: Rep) => (fileStats as (r: Rep) => Record<string, { ms: number; tests: number }>)(r);
  const spec = (file: string, ...ms: number[][]) => ({
    file,
    tests: ms.map((m) => ({ results: m.map((duration) => ({ duration })) })),
  });
  const report: Rep = {
    suites: [
      { file: 'a.e2e.ts', specs: [spec('a.e2e.ts', [1000], [500, 500])], suites: [] },
      { file: 'sub/b.e2e.ts', specs: [], suites: [{ specs: [spec('sub/b.e2e.ts', [9000])], suites: [] }] },
    ],
  };
  const bal = balanceShards as (
    f: Record<string, number>,
    h: Record<string, number>,
    k: number,
  ) => string[][];
  it('sums every result (retries included) per file, nested suites too', () => {
    expect(files(report)).toEqual({
      'a.e2e.ts': { ms: 2000, tests: 2 },
      'sub/b.e2e.ts': { ms: 9000, tests: 1 },
    });
  });
  it('puts the longest files into separate shards (greedy), by recorded duration not by count', () => {
    const counts = { 'big.ts': 1, 'a.ts': 5, 'b.ts': 5, 'c.ts': 5 };
    const hist = { 'big.ts': 600, 'a.ts': 100, 'b.ts': 100, 'c.ts': 100 };
    expect(bal(counts, hist, 2)).toEqual([['big.ts'], ['a.ts', 'b.ts', 'c.ts']]);
  });
  it('falls back to the test count without history, and to the mean for files the history lacks', () => {
    expect(bal({ 'big.ts': 9, 'a.ts': 3, 'b.ts': 3, 'c.ts': 3 }, {}, 2)).toEqual([
      ['big.ts'],
      ['a.ts', 'b.ts', 'c.ts'],
    ]);
    const out = bal({ 'new.ts': 1, 'a.ts': 1, 'b.ts': 1 }, { 'a.ts': 100, 'b.ts': 300 }, 2);
    expect(out.flat().sort()).toEqual(['a.ts', 'b.ts', 'new.ts']);
    expect(out.find((s) => s.includes('b.ts'))).toEqual(['b.ts']);
  });
  it('makes no empty shard and covers every file once', () => {
    const out = bal({ 'a.ts': 1, 'b.ts': 1 }, {}, 4);
    expect(out).toHaveLength(2);
    expect(balanceShards({}, {}, 3)).toEqual([]);
  });
  it('merges the durations of a run into the history, replacing the files it saw', () => {
    const next = (
      mergeHistory as (h: Record<string, number>, f: Record<string, { ms: number }>) => Record<string, number>
    )({ 'a.e2e.ts': 1, 'gone.ts': 7 }, files(report));
    expect(next).toEqual({ 'a.e2e.ts': 2000, 'sub/b.e2e.ts': 9000, 'gone.ts': 7 });
  });
  it('createLimiter runs at most n at once, first come first served', async () => {
    const lim = createLimiter(2) as <T>(f: () => Promise<T>) => Promise<T>;
    let live = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        lim(async () => {
          order.push(i);
          peak = Math.max(peak, ++live);
          await new Promise((r) => setTimeout(r, 10));
          live--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('hasFileFilters (a file filter must not be sharded: Playwright ORs positional patterns)', () => {
  it('sees a positional file filter', () => {
    expect(hasFileFilters(['participant/x.spec.ts'])).toBe(true);
    expect(hasFileFilters(['--repeat-each', '2', 'participant/x.spec.ts'])).toBe(true);
  });
  it('does not take flag values or flags for filters', () => {
    expect(hasFileFilters([])).toBe(false);
    expect(hasFileFilters(['-g', 'phone', '--repeat-each', '2', '--project', 'desktop'])).toBe(false);
    expect(hasFileFilters(['--grep=phone', '--headed'])).toBe(false);
  });
});
