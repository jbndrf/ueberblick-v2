import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scheduleCatchUp, scheduleDueAfter } from './catch-up';
import { cronMatches, parseCron } from './cron';
import type { ScheduleRule } from './elapsed';

const rule = (expr: string): ScheduleRule => {
  const r = parseCron(expr);
  if (!r.ok) throw new Error(r.error.message);
  return { key: 'r', cron: r.cron } as unknown as ScheduleRule;
};
const RULES = ['* * * * *', '*/15 * * * *', '30 6 * * *', '0 9 * * 1', '0 0 1 * *'].map(rule);
const T0 = Date.parse('2026-01-01T00:00:00Z');
const instant = fc.integer({ min: 0, max: 400 * 24 * 60 }).map((m) => new Date(T0 + m * 60000).toISOString());
const anyRule = fc.constantFrom(...RULES);

const timers = import.meta.glob('/packages/server/src/timers/timers.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('server timers use the shared catch-up (R1, WP-208.4)', () => {
  it('calls scheduleCatchUp and has no nextRun( call of its own', () => {
    const src = Object.values(timers)[0] ?? '';
    expect(src).toContain('scheduleCatchUp(');
    expect(src).not.toMatch(/\bnextRun\(/);
  });
});

describe('scheduleCatchUp', () => {
  it('fires once with the due slot when it is at or before now, next strictly after now', () => {
    fc.assert(
      fc.property(anyRule, instant, instant, (r, a, b) => {
        const [dueAt, now] = a <= b ? [a, b] : [b, a];
        const c = scheduleCatchUp(r, dueAt, now);
        expect(c.fire).toBe(true);
        if (!c.fire) return;
        expect(c.dueAt).toBe(dueAt);
        expect(c.next.ok).toBe(true);
        if (c.next.ok) {
          expect(Date.parse(c.next.at)).toBeGreaterThan(Date.parse(now));
          expect(cronMatches(r.cron, c.next.at)).toBe(true);
        }
      }),
    );
  });

  it('never fires when not yet due, and keeps the slot as next', () => {
    fc.assert(
      fc.property(anyRule, instant, instant, (r, a, b) => {
        fc.pre(a !== b);
        const [now, dueAt] = a < b ? [a, b] : [b, a];
        expect(scheduleCatchUp(r, dueAt, now)).toEqual({ fire: false, next: { ok: true, at: dueAt } });
      }),
    );
  });

  it('a cron that never matches has no next: beyond the horizon', () => {
    const never = rule('0 0 31 2 *');
    expect(scheduleCatchUp(never, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toEqual({
      fire: true,
      dueAt: '2026-01-01T00:00:00.000Z',
      next: { ok: false },
    });
    expect(scheduleDueAfter(never, '2026-01-01T00:00:00.000Z')).toEqual({ ok: false });
  });

  it('scheduleDueAfter is the first slot strictly after from', () => {
    expect(scheduleDueAfter(rule('30 6 * * *'), '2026-05-01T06:30:00.000Z')).toEqual({
      ok: true,
      at: '2026-05-02T06:30:00.000Z',
    });
  });
});
