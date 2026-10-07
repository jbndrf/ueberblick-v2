// Resource budget for tests and builds on the shared dev server (docs/process/logwatch.md).
// Up to 6 work packages run `npm run check` at once (UEB_CHECK_SLOTS, check-gate.sh). Each run takes a fair share of cores and of
// available memory, and every worker has a heap cap, so a runaway test dies instead of the machine.
import { availableParallelism, totalmem } from 'node:os';
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
} from 'node:fs';
import { join } from 'node:path';

export const WORKER_HEAP_MB = 2048; // hard cap per test worker (node --max-old-space-size)
export const WORKER_BUDGET_MAX_MB = 1024; // the unmeasured default and the ceiling
export const WORKER_BUDGET_MIN_MB = 512;
const BUDGET_WINDOW = 30; // recent rows of the same kind
const BUDGET_MIN_ROWS = 10; // fewer rows: no evidence, keep the default
const BUDGET_SAFETY = 1.25;
const RATCHET_RUNS = 5; // after a near-overrun the default holds for this many runs
const RATCHET_FRACTION = 0.8; // peak above this share of the memory it was given is a near-overrun
const TAIL_BYTES = 64 * 1024;
const TAIL_MAX_BYTES = 2 * 1024 * 1024; // never read more than this per acquire
const MEMORY_SHARE = 0.7; // leave 30% of available memory for agents, the IDE and the OS
export const RESERVE_MB = 4096; // free memory that is never handed out
export const YOUNG_MS = 60_000; // a run younger than this has not ramped up its memory yet

/** MemAvailable in MB (Linux), else total memory. */
export function availableMb() {
  try {
    return Number(readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/)?.[1]) / 1024;
  } catch {
    return totalmem() / 1024 / 1024;
  }
}

/** The weight this run carries (UEB_RUN_WEIGHT, default 1). Only the land train's check sets it (3). */
export function runWeight(env = process.env) {
  const w = Number(env.UEB_RUN_WEIGHT);
  return w > 0 ? w : 1;
}

/** Pure: planned MB per worker for runs of `kind`, from recent measured rows (tests.jsonl, oldest first).
 * p90 of peakRssMb / workers x 1.25, clamped to [512, 1024]; 1024 with fewer than 10 rows, and for the
 * next 5 runs after a row whose peak exceeded 80% of the memory it was given (its memShareMb; rows without one never count). */
export function workerBudgetMb(rows, kind) {
  const same = rows.filter((r) => r.kind === kind && r.peakRssMb > 0 && r.workers > 0).slice(-BUDGET_WINDOW);
  if (same.length < BUDGET_MIN_ROWS) return WORKER_BUDGET_MAX_MB;
  const overran = (r) => r.memShareMb > 0 && r.peakRssMb > RATCHET_FRACTION * r.memShareMb;
  if (same.slice(-RATCHET_RUNS).some(overran)) return WORKER_BUDGET_MAX_MB;
  const per = same.map((r) => r.peakRssMb / r.workers).sort((a, b) => a - b);
  const p90 = per[Math.min(per.length - 1, Math.ceil(0.9 * per.length) - 1)];
  const mb = Math.round(p90 * BUDGET_SAFETY);
  return Math.min(WORKER_BUDGET_MAX_MB, Math.max(WORKER_BUDGET_MIN_MB, mb));
}

/**
 * The newest rows of tests.jsonl, read backwards in TAIL_BYTES chunks: with `kind`, until BUDGET_WINDOW rows of that
 * kind are in (many agents write `scoped` rows, so 64 KB held only 5 `check` rows on 2026-10-03 and the budget fell
 * back to 1024), at most TAIL_MAX_BYTES (O(1) in file size). A cut first line and bad lines are dropped.
 */
export function readTestRows(dir, kind = null) {
  let fd;
  try {
    fd = openSync(join(dir, 'tests.jsonl'), 'r');
    const size = fstatSync(fd).size;
    let pos = size;
    let text = '';
    let rows = [];
    for (;;) {
      const len = Math.min(pos, TAIL_BYTES);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      text = buf.toString('utf8') + text;
      const lines = text.split('\n');
      if (pos > 0) lines.shift();
      rows = lines.flatMap((l) => {
        try {
          return l.trim() ? [JSON.parse(l)] : [];
        } catch {
          return [];
        }
      });
      const enough = kind === null || rows.filter((r) => r.kind === kind).length >= BUDGET_WINDOW;
      if (enough || pos === 0 || size - pos >= TAIL_MAX_BYTES) return rows;
    }
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Pure: { workers, byCpu, byMem, memShareMb } for one run (memShareMb: the memory it may use, MB). byCpu is the fair split of the cores by weight over all runs
 * (totalWeight defaults to the number of runs). availMb is read now, so it already excludes the memory that
 * older runs hold: byMem splits what is free (minus RESERVE_MB) only among this run and the young runs
 * (youngWeight, weight of the other runs started under YOUNG_MS ago) that may still grow. */
export function workerLimits({
  cores,
  availMb,
  runs,
  weight = 1,
  totalWeight = runs,
  youngWeight = 0,
  budgetMb = WORKER_BUDGET_MAX_MB,
}) {
  const byCpu = Math.floor((cores * weight) / totalWeight);
  const free = Math.max(0, availMb - RESERVE_MB);
  const memShareMb = Math.round((free * MEMORY_SHARE * weight) / (weight + youngWeight));
  const byMem = Math.floor((free * MEMORY_SHARE * weight) / (weight + youngWeight) / budgetMb);
  return { workers: Math.max(1, Math.min(byCpu, byMem)), byCpu, byMem, memShareMb };
}

/** Pure: workers for one run (see workerLimits). */
export function workerShare(input) {
  return workerLimits(input).workers;
}

/** Registers this run, with its weight, in <dir>/running and returns { workers, runs, weight, release }.
 * The pid file holds "<weight> <start ms>"; a file without a weight counts as 1, one without a start time as old. Running vitest processes are not rebalanced. */
export function acquire(dir, weight = runWeight(), kind = null, now = Date.now()) {
  const running = join(dir, 'running');
  mkdirSync(running, { recursive: true });
  let othersWeight = 0;
  let youngWeight = 0;
  const alive = readdirSync(running).filter((pid) => {
    try {
      process.kill(Number(pid), 0);
    } catch {
      rmSync(join(running, pid), { force: true });
      return false;
    }
    if (Number(pid) === process.pid) return false;
    let w = 0;
    let started = 0;
    try {
      const [wt, st] = readFileSync(join(running, pid), 'utf8').trim().split(/\s+/);
      w = Number(wt);
      started = Number(st);
    } catch {
      /* released between readdir and read: counts as weight 1 */
    }
    w = w > 0 ? w : 1;
    othersWeight += w;
    if (started > 0 && now - started < YOUNG_MS) youngWeight += w;
    return true;
  });
  writeFileSync(join(running, String(process.pid)), `${weight} ${now}`);
  const runs = alive.length + 1;
  const budgetMb = workerBudgetMb(readTestRows(dir, kind), kind);
  const env = Number(process.env.CHECK_MAX_WORKERS);
  const limits = workerLimits({
    cores: availableParallelism(),
    availMb: availableMb(),
    runs,
    weight,
    totalWeight: othersWeight + weight,
    youngWeight,
    budgetMb,
  });
  const workers = env > 0 ? env : limits.workers;
  return {
    workers,
    runs,
    weight,
    budgetMb,
    youngWeight,
    byCpu: limits.byCpu,
    byMem: limits.byMem,
    memShareMb: limits.memShareMb,
    release: () => rmSync(join(running, String(process.pid)), { force: true }),
  };
}
