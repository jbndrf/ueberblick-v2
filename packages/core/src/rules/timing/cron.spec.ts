import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CRON_HORIZON_DAYS, cronMatches, nextAfter, parseCron, type Cron } from './cron';

const cronOf = (expr: string): Cron => {
  const r = parseCron(expr);
  if (!r.ok) throw new Error(`cron ${expr} did not parse: ${r.error.message}`);
  return r.cron;
};
const next = (expr: string, from: string): string | undefined => nextAfter(cronOf(expr), from);

describe('cron', () => {
  it('every minute is the next full minute', () => {
    expect(next('* * * * *', '2026-05-01T08:00:00.000Z')).toBe('2026-05-01T08:01:00.000Z');
    expect(next('* * * * *', '2026-05-01T08:00:30.500Z')).toBe('2026-05-01T08:01:00.000Z');
  });

  it('a daily time moves to the next day once passed', () => {
    expect(next('30 6 * * *', '2026-05-01T06:29:00.000Z')).toBe('2026-05-01T06:30:00.000Z');
    expect(next('30 6 * * *', '2026-05-01T06:30:00.000Z')).toBe('2026-05-02T06:30:00.000Z');
  });

  it('lists, ranges and steps', () => {
    expect(next('0,30 9-10 * * *', '2026-05-01T09:30:00.000Z')).toBe('2026-05-01T10:00:00.000Z');
    expect(next('*/15 * * * *', '2026-05-01T08:50:00.000Z')).toBe('2026-05-01T09:00:00.000Z');
    expect(next('10-20/5 * * * *', '2026-05-01T08:00:00.000Z')).toBe('2026-05-01T08:10:00.000Z');
  });

  it('day of week: Monday 07:00 (0 and 7 are Sunday)', () => {
    // 2026-05-01 is a Friday
    expect(next('0 7 * * 1', '2026-05-01T08:00:00.000Z')).toBe('2026-05-04T07:00:00.000Z');
    expect(next('0 7 * * 7', '2026-05-01T08:00:00.000Z')).toBe('2026-05-03T07:00:00.000Z');
    expect(next('0 7 * * 0', '2026-05-01T08:00:00.000Z')).toBe('2026-05-03T07:00:00.000Z');
  });

  it('day of month and day of week both restricted: either matches', () => {
    // the 15th or any Monday; from Fri 1 May the Monday 4 May comes first
    expect(next('0 0 15 * 1', '2026-05-01T08:00:00.000Z')).toBe('2026-05-04T00:00:00.000Z');
  });

  it('month and day of month, with a year rollover', () => {
    expect(next('0 0 1 1 *', '2026-05-01T08:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z');
    expect(next('0 0 29 2 *', '2026-05-01T08:00:00.000Z')).toBe('2028-02-29T00:00:00.000Z');
  });

  it('a date that never exists has no next time', () => {
    expect(next('0 0 31 2 *', '2026-05-01T08:00:00.000Z')).toBeUndefined();
  });

  it('rejects malformed expressions', () => {
    for (const bad of [
      '* * * *',
      '60 * * * *',
      '* 24 * * *',
      '* * 0 * *',
      '* * * 13 *',
      '*/0 * * * *',
      'a * * * *',
      '5-3 * * * *',
      '* * * * 8',
    ])
      expect(parseCron(bad).ok, bad).toBe(false);
  });

  it('is strictly after `from`, and the first match (property)', () => {
    const at = fc
      .integer({ min: 0, max: 60 * 24 * 400 })
      .map((m) => new Date(Date.UTC(2026, 0, 1) + m * 60_000).toISOString());
    fc.assert(
      fc.property(at, fc.nat(59), fc.nat(23), (from, minute, hour) => {
        const got = nextAfter(cronOf(`${minute} ${hour} * * *`), from) as string;
        expect(Date.parse(got)).toBeGreaterThan(Date.parse(from));
        expect(Date.parse(got) - Date.parse(from)).toBeLessThanOrEqual(24 * 3600_000);
        const d = new Date(got);
        expect([d.getUTCHours(), d.getUTCMinutes()]).toEqual([hour, minute]);
      }),
    );
  });

  it('errors carry the position of the offending field', () => {
    const at = (expr: string) => {
      const r = parseCron(expr);
      return r.ok ? undefined : r.error.position;
    };
    expect(at('* * * *')).toBe(7);
    expect(at('* * * * * *')).toBe(10);
    expect(at('0 24 * * *')).toBe(2);
    expect(at('0 0  x * *')).toBe(5);
    const r = parseCron('60 * * * *');
    expect(!r.ok && r.error.message).toContain('minute');
  });

  it('nextAfter is after, matches, and skips no earlier match (property)', () => {
    const at = fc
      .integer({ min: 0, max: 60 * 24 * 800 })
      .map((m) => new Date(Date.UTC(2026, 0, 1) + m * 60_000 + 17_000).toISOString());
    const expr = fc
      .tuple(
        fc.constantFrom('*', '0', '*/15', '5,35', '10-20/5', '59'),
        fc.constantFrom('*', '0', '6', '*/6', '9-17'),
        fc.constantFrom('*', '1', '15', '28-31', '*/10'),
        fc.constantFrom('*', '2', '1-6', '*/4'),
        fc.constantFrom('*', '1', '0,6', '7', '1-5'),
      )
      .map((f) => f.join(' '));
    fc.assert(
      fc.property(at, expr, (from, e) => {
        const c = cronOf(e);
        const got = nextAfter(c, from);
        if (got === undefined) return;
        expect(Date.parse(got)).toBeGreaterThan(Date.parse(from));
        expect(cronMatches(c, got)).toBe(true);
        // no earlier match strictly between from and got (walk by minute, for gaps up to 3 days)
        const span = (Date.parse(got) - Date.parse(from)) / 60_000;
        if (span > 60 * 24 * 3) return; // longer gaps are covered by the example cases
        for (
          let t = Math.floor(Date.parse(from) / 60_000) * 60_000 + 60_000;
          t < Date.parse(got);
          t += 60_000
        )
          expect(cronMatches(c, new Date(t).toISOString())).toBe(false);
      }),
      { numRuns: 60 },
    );
  });

  it('a search for a never-matching date is bounded (8 years of days, not minutes)', () => {
    expect(CRON_HORIZON_DAYS).toBe(2928);
    expect(nextAfter(cronOf('0 0 31 2 *'), '2026-05-01T08:00:00.000Z')).toBeUndefined();
  });
});
