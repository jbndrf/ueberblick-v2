// WP-469: the idle sweep of `{ schedule, idle }`: fires only on Objekte idle >= N days, in bounded batches with a cursor.
import { describe, expect, it } from 'vitest';
import type { CompiledConfig, FeatureId, Json, Run } from '@ueberblick/core';
import type { SubmitResult } from '../store';
import { build, fid, golden, setup, withAuto } from '../store/run/testkit';
import { createLogger } from '../log';
import { createTimers } from './index';

const base = golden('musterstadt-plain').file;
const config: CompiledConfig = build(
  withAuto(base, [['system_faellig', 'ruhig', { schedule: '0 6 * * *', idle: 'days(7)' }]]),
);

const DAY = 86_400_000;
const START = '2026-03-02T06:00:00.000Z';
const ago = (days: number): string => new Date(Date.parse(START) - days * DAY).toISOString();

type Env = ReturnType<typeof env>;

function env(submitOf?: (real: (run: Run) => SubmitResult) => (run: Run) => SubmitResult) {
  const clock = { at: '2026-03-01T08:00:00.000Z', step: 0 };
  const holder: { t?: ReturnType<typeof createTimers> } = {};
  const ctx = setup({
    config,
    clock: { now: () => clock.at },
    hooks: [(c) => (holder.t as ReturnType<typeof createTimers>).hook(c)],
  });
  const timers = createTimers(ctx.db, {
    clock: {
      now: () => {
        // `step` ms pass per read: a slow sweep, deterministic
        clock.at = new Date(Date.parse(clock.at) + clock.step).toISOString();
        return clock.at;
      },
    },
    ids: ctx.deps.ids,
    geo: ctx.deps.geo,
    versions: { configFor: (v) => (v === 1 ? config : undefined), deployed: () => ({ version: 1, config }) },
    submit: (run) => (submitOf ? submitOf((r) => ctx.store.submit(r))(run) : ctx.store.submit(run)),
    log: createLogger({ sink: () => undefined, now: () => 0 }),
  });
  holder.t = timers;
  return { ctx, timers, clock };
}

/** One tree per entry; tree i was last changed `ages[i]` days before the sweep. */
function seed(e: Env, ages: readonly number[]): FeatureId[] {
  const ids = ages.map((_, i) => fid(100 + i));
  e.ctx.seed(
    ids.map((id, i) => ({
      id,
      type: 'baum',
      properties: {
        geometrie: { type: 'Point', coordinates: [7.2 + i / 1000, 50.8] },
        stage: 'erfasst',
        kontrolle_faellig: false,
      } as Record<string, Json>,
    })),
  );
  const set = e.ctx.db.prepare('UPDATE features SET changed_at = ? WHERE id = ?');
  ids.forEach((id, i) => set.run(ago(ages[i] as number), id));
  return ids;
}

const flagged = (e: Env, id: FeatureId): Json | undefined =>
  e.ctx.store.facts.feature(id)?.properties['kontrolle_faellig'];
const sweepRows = (e: Env): string[] =>
  e.ctx.db
    .prepare<{ feature_id: string }>("SELECT feature_id FROM timers WHERE feature_id LIKE '~sweep:%'")
    .all()
    .map((r) => r.feature_id);

describe('timers: idle sweep', () => {
  it('fires its system run only on Objekte idle at least N days', () => {
    const e = env();
    const ids = seed(e, [30, 7, 6, 0]);
    e.timers.syncSchedules();
    e.clock.at = START;
    expect(e.timers.tick(START)).toEqual({ fired: 2, refused: 0, skipped: 0, failed: 0 });
    expect(ids.map((id) => flagged(e, id))).toEqual([true, true, false, false]);
    expect(sweepRows(e)).toEqual([]);
    // the fired Objekte were changed by the run, so the next day's sweep leaves them alone and takes the one
    // that has now been idle for 7 days
    const next = '2026-03-03T06:00:00.000Z';
    e.clock.at = next;
    expect(e.timers.tick(next)).toMatchObject({ fired: 1 });
    expect(flagged(e, ids[2] as FeatureId)).toBe(true);
  });

  it('works a big type off in batches of `limit` across ticks with a cursor', () => {
    const e = env();
    const ids = seed(e, [20, 20, 20, 20, 20, 20, 20]);
    e.timers.syncSchedules();
    e.clock.at = START;
    expect(e.timers.tick(START, 500, 3)).toMatchObject({ fired: 3 });
    expect(ids.map((id) => flagged(e, id))).toEqual([true, true, true, false, false, false, false]);
    expect(sweepRows(e)).toHaveLength(1);
    expect(e.timers.tick(START, 500, 3)).toMatchObject({ fired: 3 });
    expect(sweepRows(e)).toHaveLength(1);
    expect(e.timers.tick(START, 500, 3)).toMatchObject({ fired: 1 });
    expect(sweepRows(e)).toEqual([]);
    expect(ids.every((id) => flagged(e, id) === true)).toBe(true);
  });

  it('a cron match while a sweep is in progress does not start a second sweep', () => {
    const e = env();
    seed(e, [20, 20, 20, 20]);
    e.timers.syncSchedules();
    e.clock.at = START;
    e.timers.tick(START, 500, 2);
    expect(sweepRows(e)).toHaveLength(1);
    e.ctx.db.prepare("UPDATE timers SET due_at = ? WHERE feature_id = ''").run(START);
    // the cron row is skipped (a sweep row exists), and the sweep row resumes and finishes
    expect(e.timers.tick(START, 500, 2)).toMatchObject({ fired: 2 });
    expect(e.timers.tick(START, 500, 2)).toMatchObject({ fired: 0 }); // a full last batch ends with an empty one
    expect(sweepRows(e)).toEqual([]);
  });

  it('a deploy that drops the rule removes its sweep row', () => {
    const e = env();
    seed(e, [20, 20, 20]);
    e.timers.syncSchedules();
    e.clock.at = START;
    e.timers.tick(START, 500, 1);
    expect(sweepRows(e)).toHaveLength(1);
    e.ctx.db.prepare("UPDATE timers SET rule = 'gone' WHERE feature_id LIKE '~sweep:%'").run();
    e.timers.rebuild();
    expect(sweepRows(e)).toEqual([]);
  });

  it('visits pages of 50, at most `sweepCap` Objekte per tick (v3 pages of 50, cap 1000)', () => {
    const e = env();
    seed(
      e,
      Array.from({ length: 120 }, () => 20),
    );
    e.timers.syncSchedules();
    e.clock.at = START;
    expect(e.timers.tick(START, 500, 110)).toMatchObject({ fired: 110 });
    expect(sweepRows(e)).toHaveLength(1);
    expect(e.timers.tick(START, 500, 110)).toMatchObject({ fired: 10 });
    expect(sweepRows(e)).toEqual([]);
  });

  it('stops at a page boundary when the 40 s time budget is spent and resumes next tick', () => {
    const e = env();
    seed(
      e,
      Array.from({ length: 120 }, () => 20),
    );
    e.timers.syncSchedules();
    e.clock.at = START;
    e.clock.step = 25_000; // every clock read is 25 s: the second page check is over budget
    const first = e.timers.tick(START);
    expect(first.fired).toBe(50);
    expect(sweepRows(e)).toHaveLength(1);
    e.clock.step = 0;
    expect(e.timers.tick(START).fired).toBe(70);
    expect(sweepRows(e)).toEqual([]);
  });

  it('a failing Objekt is counted and does not abort the page', () => {
    let n = 0;
    const e = env((real) => (run) => {
      if (++n === 2) throw new Error('boom');
      return real(run);
    });
    const ids = seed(e, [20, 20, 20]);
    e.timers.syncSchedules();
    e.clock.at = START;
    expect(e.timers.tick(START)).toEqual({ fired: 2, refused: 0, skipped: 0, failed: 1 });
    expect(ids.map((id) => flagged(e, id))).toEqual([true, false, true]);
  });
});
