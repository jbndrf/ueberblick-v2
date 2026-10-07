/**
 * The one place that imports the SQLite driver (A-001). Everything else uses the `Db` interface,
 * so the driver (better-sqlite3 on Node, bun:sqlite on Bun) stays swappable in one file.
 */
import { SQL_APP_FUNCTIONS } from '@ueberblick/core';
import Database from 'better-sqlite3';

export type SqlValue = string | number | bigint | Uint8Array | null;

export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface Stmt<Row> {
  run(...params: SqlValue[]): RunResult;
  get(...params: SqlValue[]): Row | undefined;
  all(...params: SqlValue[]): Row[];
  iterate(...params: SqlValue[]): IterableIterator<Row>;
}

export interface Db {
  exec(sql: string): void;
  prepare<Row = Record<string, SqlValue>>(sql: string): Stmt<Row>;
  /**
   * Runs `fn` in one transaction: commits on return, rolls back and rethrows on throw. Nests as a savepoint.
   * `immediate` takes the write lock at BEGIN (waiting up to the busy timeout), so reads inside `fn` see the final state.
   */
  transaction<T>(fn: () => T, opts?: { readonly immediate?: boolean }): T;
  close(): void;
}

/** Per-connection tuning (docs/12: idle RSS matters on a 1 GB server). */
const PRAGMAS = [
  'busy_timeout = 5000', // first: two processes switching a fresh file to WAL must wait, not fail (WP-1032)
  'journal_mode = WAL',
  'synchronous = NORMAL',
  'foreign_keys = ON',
  'cache_size = -8192', // 8 MiB per connection
  'temp_store = MEMORY',
] as const;

const BUSY_BUDGET_MS = 5000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Retries `fn` while it throws SQLITE_BUSY, with a growing synchronous wait (10 ms doubling to 50 ms),
 * for at most `budgetMs`; then rethrows. Any other error is rethrown at once. The `journal_mode = WAL`
 * switch on a brand-new file can return SQLITE_BUSY without calling the busy handler (WP-1032).
 */
export function retryBusy<T>(
  fn: () => T,
  budgetMs: number = BUSY_BUDGET_MS,
  sleep: (ms: number) => void = sleepSync,
): T {
  let waited = 0;
  let step = 10;
  for (;;) {
    try {
      return fn();
    } catch (e) {
      const busy = e instanceof Error && (e as { code?: unknown }).code === 'SQLITE_BUSY';
      if (!busy || waited >= budgetMs) throw e;
      sleep(step);
      waited += step;
      step = Math.min(step * 2, 50);
    }
  }
}

/** Opens a file or `:memory:` database and applies the platform pragmas. */
export function openSqlite(path: string): Db {
  const raw = new Database(path);
  for (const p of PRAGMAS) retryBusy(() => raw.pragma(p));
  // Unicode case folding and calendar months: what `toSql` emits for lower/upper/months (docs/06 "Parity").
  for (const f of SQL_APP_FUNCTIONS)
    raw.function(
      f.name,
      { deterministic: true, varargs: false },
      f.fn as (...a: unknown[]) => string | number | null,
    );
  return {
    exec: (sql) => void raw.exec(sql),
    prepare: <Row>(sql: string): Stmt<Row> => {
      const s = raw.prepare(sql);
      return {
        run: (...params) => s.run(...params),
        get: (...params) => s.get(...params) as Row | undefined,
        all: (...params) => s.all(...params) as Row[],
        iterate: (...params) => s.iterate(...params) as IterableIterator<Row>,
      };
    },
    transaction: <T>(fn: () => T, opts?: { readonly immediate?: boolean }): T =>
      opts?.immediate ? raw.transaction(fn).immediate() : raw.transaction(fn)(),
    close: () => void raw.close(),
  };
}
