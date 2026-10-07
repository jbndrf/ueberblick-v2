import { describe, expect, it } from 'vitest';
import type { Timers, TickResult } from './contract';
import { startTimersLoop, type TimersLoopDeps } from './loop';

const zero: TickResult = { fired: 0, refused: 0, skipped: 0, failed: 0 };

/** A scheduler the test drives by hand, and stub timers that record what the loop asked of them. */
function world(keys: string[] = ['a', 'b']) {
  const calls: string[] = [];
  const clock = { at: '2026-03-01T08:00:00.000Z' };
  const beat: { fn: (() => void) | undefined; ms?: number; stopped: number } = { fn: undefined, stopped: 0 };
  const failing = new Set<string>();
  const timers = (key: string): Pick<Timers, 'syncSchedules' | 'tick'> => ({
    syncSchedules() {
      calls.push(`sync ${key}`);
      return 0;
    },
    tick(now) {
      calls.push(`tick ${key} ${now}`);
      if (failing.has(key)) throw new Error(`${key} is down`);
      return zero;
    },
  });
  const errors: string[] = [];
  const deps: TimersLoopDeps = {
    clock: { now: () => clock.at },
    projects: () => keys,
    timers,
    intervalMs: 30_000,
    every(fn, ms) {
      beat.fn = fn;
      beat.ms = ms;
      return () => {
        beat.stopped++;
        beat.fn = undefined;
      };
    },
    onError: (key, e) => errors.push(`${key}: ${(e as Error).message}`),
  };
  return { calls, clock, beat, keys, errors, failing, start: () => startTimersLoop(deps) };
}

describe('timers loop previews (WP-340)', () => {
  it('ticks the preview keys as a second list after the projects, and a failing preview stops nothing', () => {
    const calls: string[] = [];
    const loop = startTimersLoop({
      clock: { now: () => 'T' },
      projects: () => ['a'],
      previews: () => ['a__vorschau'],
      timers: (key) => ({
        syncSchedules: () => (calls.push(`sync ${key}`), 0),
        tick: () => {
          calls.push(`tick ${key}`);
          if (key === 'a__vorschau') throw new Error('down');
          return zero;
        },
      }),
      intervalMs: 1,
      every: () => () => undefined,
      onError: (key) => calls.push(`error ${key}`),
    });
    loop.stop();
    expect(calls).toEqual(['sync a', 'tick a', 'sync a__vorschau', 'tick a__vorschau', 'error a__vorschau']);
  });
});

describe('timers loop', () => {
  it('syncs the schedules of every project once at start, then ticks now, then on every beat', () => {
    const w = world();
    w.start();
    expect(w.calls).toEqual([
      'sync a',
      'tick a 2026-03-01T08:00:00.000Z',
      'sync b',
      'tick b 2026-03-01T08:00:00.000Z',
    ]);
    expect(w.beat.ms).toBe(30_000);
    w.calls.length = 0;
    w.clock.at = '2026-03-01T08:00:30.000Z';
    w.beat.fn?.();
    expect(w.calls).toEqual(['tick a 2026-03-01T08:00:30.000Z', 'tick b 2026-03-01T08:00:30.000Z']);
  });

  it('a project that appears later is synced once, then ticked', () => {
    const w = world(['a']);
    w.start();
    w.calls.length = 0;
    w.keys.push('c');
    w.beat.fn?.();
    w.beat.fn?.();
    expect(w.calls.filter((c) => c === 'sync c')).toHaveLength(1);
    expect(w.calls.filter((c) => c.startsWith('sync a'))).toHaveLength(0);
  });

  it('one failing project is reported and does not stop the others or the loop', () => {
    const w = world();
    w.failing.add('a');
    w.start();
    expect(w.errors).toEqual(['a: a is down']);
    expect(w.calls).toContain('tick b 2026-03-01T08:00:00.000Z');
    w.beat.fn?.();
    expect(w.errors).toHaveLength(2);
  });

  it('a project whose timers cannot be built is reported too', () => {
    const w = world(['a']);
    const loop = startTimersLoop({
      clock: { now: () => w.clock.at },
      projects: () => ['nowhere'],
      timers: () => {
        throw new Error('no database');
      },
      intervalMs: 1,
      every: () => () => undefined,
      onError: (k, e) => w.errors.push(`${k}: ${(e as Error).message}`),
    });
    expect(w.errors).toEqual(['nowhere: no database']);
    loop.stop();
  });

  it('stop cancels the beat, is idempotent, and later beats do nothing', () => {
    const w = world();
    const loop = w.start();
    w.calls.length = 0;
    loop.stop();
    loop.stop();
    expect(w.beat.stopped).toBe(1);
    expect(loop.runOnce()).toEqual(zero); // a stopped loop does not tick
    expect(w.calls).toEqual([]);
  });

  it('runOnce ticks immediately and sums the results', () => {
    const w = world(['a', 'b']);
    const loop = w.start();
    expect(loop.runOnce()).toEqual(zero);
  });

  it('the default beat is a real, unref-ed interval that stop clears', async () => {
    let ticks = 0;
    const loop = startTimersLoop({
      clock: { now: () => new Date().toISOString() },
      projects: () => ['a'],
      timers: () => ({
        syncSchedules: () => 0,
        tick: () => {
          ticks++;
          return zero;
        },
      }),
      intervalMs: 5,
    });
    await new Promise((r) => setTimeout(r, 40));
    loop.stop();
    const seen = ticks;
    expect(seen).toBeGreaterThan(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(ticks).toBe(seen);
  });
});
