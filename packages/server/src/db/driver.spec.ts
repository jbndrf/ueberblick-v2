import { describe, expect, it } from 'vitest';
import { openSqlite, retryBusy } from './driver';

describe('openSqlite registers the application functions (A-001 seam)', () => {
  const db = openSqlite(':memory:');
  const one = (sql: string, ...p: string[]) =>
    (db.prepare<{ v: string | null }>(sql).get(...p) as { v: string | null }).v;

  it('folds case with Unicode rules, as evaluate does', () => {
    expect(one('SELECT ub_lower(?) AS v', 'ÄRGER')).toBe('ärger');
    expect(one('SELECT ub_upper(?) AS v', 'straße')).toBe('STRASSE');
    expect(one('SELECT ub_upper(NULL) AS v')).toBeNull();
  });

  it('adds calendar months with month-end clamping', () => {
    expect(one("SELECT ub_add_months('2028-01-31T00:00:00.000Z', 1) AS v")).toBe('2028-02-29T00:00:00.000Z');
    expect(one("SELECT ub_add_months('2026-03-31T00:00:00.000Z', -1) AS v")).toBe('2026-02-28T00:00:00.000Z');
    expect(one("SELECT ub_add_months('kein datum', 1) AS v")).toBeNull();
  });
});

describe('retryBusy (WP-1032: WAL switch on a fresh file can return SQLITE_BUSY)', () => {
  const busy = () => Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });

  it('retries SQLITE_BUSY with growing waits, then returns the result', () => {
    const waits: number[] = [];
    let calls = 0;
    const r = retryBusy(
      () => {
        if (++calls < 4) throw busy();
        return 'ok';
      },
      5000,
      (ms) => void waits.push(ms),
    );
    expect(r).toBe('ok');
    expect(waits).toEqual([10, 20, 40]);
  });

  it('rethrows other errors at once', () => {
    let calls = 0;
    expect(() =>
      retryBusy(
        () => {
          calls++;
          throw new Error('boom');
        },
        5000,
        () => undefined,
      ),
    ).toThrow('boom');
    expect(calls).toBe(1);
  });

  it('gives up with the busy error once the budget is spent', () => {
    let calls = 0;
    expect(() =>
      retryBusy(
        () => {
          calls++;
          throw busy();
        },
        100,
        () => undefined,
      ),
    ).toThrow('database is locked');
    expect(calls).toBeGreaterThan(1);
  });
});
