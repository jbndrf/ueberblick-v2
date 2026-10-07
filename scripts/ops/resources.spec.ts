import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { acquire, readTestRows, runWeight, workerBudgetMb, workerLimits, workerShare } from './resources.mjs';
import { specEnv } from '../testing/spec-env.mjs';

describe('resource budget', () => {
  it('shares cores between concurrent checks', () => {
    expect(workerShare({ cores: 64, availMb: 60_000, runs: 1 })).toBe(38); // memory-bound: (60 GB - 4 GB reserve) × 0.7 / 1 GB
    expect(workerShare({ cores: 64, availMb: 60_000, runs: 4 })).toBe(16); // others are old: no memory split
    expect(workerShare({ cores: 64, availMb: 60_000, runs: 4, youngWeight: 3 })).toBe(9); // 38 / 4
    expect(workerShare({ cores: 8, availMb: 60_000, runs: 1 })).toBe(8); // cpu-bound
  });
  it('never drops below one worker when memory is tight', () => {
    expect(workerShare({ cores: 64, availMb: 500, runs: 4 })).toBe(1);
    expect(workerShare({ cores: 64, availMb: 500, runs: 5, weight: 3, totalWeight: 7 })).toBe(1);
  });
});

describe('weighted share (WP-967)', () => {
  const big = { cores: 64, availMb: 600_000, runs: 5, totalWeight: 7 };
  it('weights 3+1+1+1+1 on 64 cores: the train gets 27, each other run 9', () => {
    expect(workerShare({ ...big, weight: 3 })).toBe(27);
    expect(workerShare({ ...big, weight: 1 })).toBe(9);
  });
  it('memory-bound cases scale the same way', () => {
    // (30 000 - 4096) x 0.7 = 18 134 MB; all four others young (weight 4): x 3/7 / 1024 = 7.59 -> 7 ; x 1/7 (young 6) -> 2
    const mem = { cores: 64, availMb: 30_000, runs: 5, totalWeight: 7 };
    expect(workerShare({ ...mem, weight: 3, youngWeight: 4 })).toBe(7);
    expect(workerShare({ ...mem, weight: 1, youngWeight: 6 })).toBe(2);
  });
  it('reads the weight from UEB_RUN_WEIGHT, default 1', () => {
    expect(runWeight({})).toBe(1);
    expect(runWeight({ UEB_RUN_WEIGHT: '3' })).toBe(3);
    expect(runWeight({ UEB_RUN_WEIGHT: 'x' })).toBe(1);
  });
});

describe('acquire', () => {
  let dir: string;
  const kids: ChildProcess[] = [];
  afterEach(() => {
    for (const k of kids.splice(0)) k.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const sleeper = () => {
    const k = spawn('sleep', ['30'], { env: specEnv() });
    kids.push(k);
    return String(k.pid);
  };

  it('writes its weight, reads the others (an empty file counts as 1), drops stale pids', () => {
    dir = mkdtempSync(join(tmpdir(), 'res-'));
    const running = join(dir, 'running');
    mkdirSync(running);
    const heavy = sleeper();
    const old = sleeper();
    writeFileSync(join(running, heavy), '3');
    writeFileSync(join(running, old), '');
    writeFileSync(join(running, '999999999'), '5'); // stale
    const prev = process.env.CHECK_MAX_WORKERS;
    delete process.env.CHECK_MAX_WORKERS;
    try {
      const slot = acquire(dir, 2);
      expect(slot.runs).toBe(3);
      expect(slot.weight).toBe(2);
      expect(readFileSync(join(running, String(process.pid)), 'utf8')).toMatch(/^2 \d+$/);
      expect(() => readFileSync(join(running, '999999999'))).toThrow();
      // total weight 3 + 1 + 2 = 6; this run takes a third of the machine
      expect(slot.workers).toBeGreaterThanOrEqual(1);
      expect(slot.workers).toBeLessThanOrEqual(Math.max(1, Math.floor(availableParallelism() / 3)));
      slot.release();
    } finally {
      if (prev !== undefined) process.env.CHECK_MAX_WORKERS = prev;
    }
  });

  it('writes a start time; only runs younger than 60 s count as young; no start time counts as old', () => {
    dir = mkdtempSync(join(tmpdir(), 'res-'));
    const running = join(dir, 'running');
    mkdirSync(running);
    const now = 1_000_000_000;
    const fresh = sleeper();
    const aged = sleeper();
    const legacy = sleeper();
    writeFileSync(join(running, fresh), `2 ${now - 10_000}`);
    writeFileSync(join(running, aged), `1 ${now - 120_000}`);
    writeFileSync(join(running, legacy), '1');
    const prev = process.env.CHECK_MAX_WORKERS;
    delete process.env.CHECK_MAX_WORKERS;
    try {
      const slot = acquire(dir, 1, null, now);
      expect(slot.youngWeight).toBe(2);
      expect(readFileSync(join(running, String(process.pid)), 'utf8')).toBe(`1 ${now}`);
      expect(slot.byCpu).toBe(Math.floor(availableParallelism() / 5));
      slot.release();
    } finally {
      if (prev !== undefined) process.env.CHECK_MAX_WORKERS = prev;
    }
  });

  it('CHECK_MAX_WORKERS still overrides', () => {
    dir = mkdtempSync(join(tmpdir(), 'res-'));
    const prev = process.env.CHECK_MAX_WORKERS;
    process.env.CHECK_MAX_WORKERS = '7';
    try {
      const slot = acquire(dir, 3);
      expect(slot.workers).toBe(7);
      slot.release();
    } finally {
      if (prev === undefined) delete process.env.CHECK_MAX_WORKERS;
      else process.env.CHECK_MAX_WORKERS = prev;
    }
  });
});

describe('memory is split only among runs that may still grow (WP-995)', () => {
  const at1035 = { cores: 64, availMb: 30_493, runs: 4, weight: 3, totalWeight: 6, budgetMb: 671 };
  it('three older runs hold their memory already: 27 workers, not 15', () => {
    expect(workerLimits(at1035)).toEqual({
      workers: 27,
      byCpu: 32,
      byMem: 27,
      memShareMb: expect.any(Number),
    });
  });
  it('three runs started 10 s ago (young weight 3): 13', () => {
    expect(workerLimits({ ...at1035, youngWeight: 3 })).toEqual({
      workers: 13,
      byCpu: 32,
      byMem: 13,
      memShareMb: expect.any(Number),
    });
  });
  it('memShareMb is the memory the run may use: (avail - reserve) x 0.7 x weight/(weight+young)', () => {
    const l = workerLimits({
      cores: 64,
      availMb: 36_153 + 4096,
      runs: 4,
      weight: 3,
      totalWeight: 5,
      youngWeight: 2,
    });
    expect(l.memShareMb).toBe(Math.round((36_153 * 0.7 * 3) / 5));
  });
  it('the reserve is never handed out', () => {
    expect(workerShare({ cores: 64, availMb: 4000, runs: 1 })).toBe(1);
  });
});

describe('measured worker budget (WP-986)', () => {
  const rows = (n: number, perWorker: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: n }, () => ({
      kind: 'check',
      workers: 10,
      peakRssMb: perWorker * 10,
      budgetMb: 1024,
      ...extra,
    }));
  it('30 rows at 500 MB/worker give p90 x 1.25 = 625', () => {
    expect(workerBudgetMb(rows(30, 500), 'check')).toBe(625);
  });
  it('fewer than 10 rows keep 1024', () => {
    expect(workerBudgetMb(rows(5, 500), 'check')).toBe(1024);
  });
  it('clamps to [512, 1024]', () => {
    expect(workerBudgetMb(rows(30, 1200), 'check')).toBe(1024);
    expect(workerBudgetMb(rows(30, 100), 'check')).toBe(512);
  });
  it('only rows of the same kind count', () => {
    expect(workerBudgetMb(rows(30, 500, { kind: 'scoped' }), 'check')).toBe(1024);
  });
  it('an over-80%-of-share row holds 1024 for the next 5 runs, then the budget returns', () => {
    const hot = { kind: 'check', workers: 10, peakRssMb: 13_000, memShareMb: 15_184, budgetMb: 1024 };
    const calm = rows(30, 400, { memShareMb: 15_184 });
    expect(workerBudgetMb([...calm, hot], 'check')).toBe(1024);
    expect(workerBudgetMb([...calm, hot, ...rows(4, 400, { memShareMb: 15_184 })], 'check')).toBe(1024);
    expect(workerBudgetMb([...calm, hot, ...rows(5, 400, { memShareMb: 15_184 })], 'check')).toBeLessThan(
      1024,
    );
  });
  it('the 10:56Z row (peak 8 938 of share 15 184 = 59%) is not an overrun', () => {
    const r = { kind: 'check', workers: 16, peakRssMb: 8938, memShareMb: 15_184, budgetMb: 665 };
    expect(workerBudgetMb([...rows(30, 400), r], 'check')).toBeLessThan(1024);
  });
  it('rows without memShareMb never trigger the ratchet', () => {
    const old = { kind: 'check', workers: 10, peakRssMb: 9000, budgetMb: 1024 };
    expect(workerBudgetMb([...rows(30, 400), old], 'check')).toBeLessThan(1024);
  });
  it('the train gets more workers with the measured budget (45 569 MB, weight 3 of 5)', () => {
    const base = { cores: 64, availMb: 45_569, runs: 3, weight: 3, totalWeight: 5, youngWeight: 2 };
    expect(workerShare(base)).toBe(17); // (45 569 - 4096) x 0.7 x 3/5 / 1024 = 17.0
    expect(workerShare({ ...base, budgetMb: 625 })).toBe(27); // 27.8
  });
  it('readTestRows with a kind reads back until 30 rows of that kind, even past many rows of another kind', () => {
    const d = mkdtempSync(join(tmpdir(), 'res-'));
    try {
      const check = JSON.stringify({ kind: 'check', workers: 10, peakRssMb: 5000 });
      const scoped = JSON.stringify({ kind: 'scoped', workers: 1, peakRssMb: 1, pad: 'x'.repeat(1500) });
      // 40 check rows, then 200 scoped rows (~300 KB): the old 64 KB tail held no check row at all
      writeFileSync(
        join(d, 'tests.jsonl'),
        [...Array(40).fill(check), ...Array(200).fill(scoped)].join('\n') + '\n',
      );
      const got = readTestRows(d, 'check');
      expect(got.filter((r) => r.kind === 'check').length).toBeGreaterThanOrEqual(30);
      expect(workerBudgetMb(got, 'check')).toBe(625); // 500 MB/worker · 1.25, not the 1024 fallback
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('readTestRows reads only the tail and drops the cut first line', () => {
    const d = mkdtempSync(join(tmpdir(), 'res-'));
    try {
      const line = JSON.stringify({ kind: 'check', workers: 1, peakRssMb: 1, pad: 'x'.repeat(1000) });
      writeFileSync(join(d, 'tests.jsonl'), Array(200).fill(line).join('\n') + '\n{bad\n');
      const got = readTestRows(d);
      expect(got.length).toBeGreaterThan(10);
      expect(got.length).toBeLessThan(80);
      expect(readTestRows(join(d, 'none'))).toEqual([]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
