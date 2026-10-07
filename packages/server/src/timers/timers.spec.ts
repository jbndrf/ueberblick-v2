import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CompiledConfig, FeatureId, FoldedFeature, Json, Key } from '@ueberblick/core';
import {
  anna,
  build,
  fid,
  golden,
  IDS,
  seedMusterstadt,
  setup,
  withAuto,
  type AutoAdd,
  type Ctx,
} from '../store/run/testkit';
import { createLogger } from '../log';
import { createTimers } from './index';
import type { Timers } from './index';

const lines: string[] = [];
const log = createLogger({ sink: (l) => lines.push(l), now: () => 0 });
const base = golden('musterstadt-plain').file;
const ELAPSED = 'system_faellig.kontrolle_wird_faellig' as Key;
const NIGHT = { label: { de: 'Nachtlauf' }, on: '$none', when: "actor.kind == 'system'" } as const;

const withTimes = (extra: readonly AutoAdd[] = []): CompiledConfig =>
  build(
    withAuto(base, [['nachtlauf', 'taeglich', { schedule: '0 6 * * *' }], ...extra], [], {
      nachtlauf: NIGHT,
    }),
  );

const plain = withTimes();
const WARN: AutoAdd = [
  'system_faellig',
  'vorwarnung',
  { elapsed: { from: 'self.faellig_am', offset: '-days(14)' }, when: "self.stage != 'erledigt'" },
];

interface Env {
  readonly ctx: Ctx;
  readonly timers: Timers;
  readonly clock: { at: string };
}

function env(config: CompiledConfig = plain): Env {
  const clock = { at: '2026-03-01T08:00:00.000Z' };
  const holder: { t?: Timers } = {};
  const ctx = setup({
    config,
    clock: { now: () => clock.at },
    hooks: [(c) => (holder.t as Timers).hook(c)],
  });
  const timers = createTimers(ctx.db, {
    clock: ctx.deps.clock,
    ids: ctx.deps.ids,
    geo: ctx.deps.geo,
    versions: { configFor: (v) => (v === 1 ? config : undefined), deployed: () => ({ version: 1, config }) },
    submit: (run) => ctx.store.submit(run),
    log,
  });
  holder.t = timers;
  return { ctx, timers, clock };
}

const tree = (n: number, faellig: string | null, extra: Record<string, Json> = {}) => ({
  id: fid(100 + n),
  type: 'baum',
  properties: {
    geometrie: { type: 'Point', coordinates: [7.2 + n / 1000, 50.8] },
    stage: 'erfasst',
    kontrolle_faellig: false,
    ...(faellig === null ? {} : { faellig_am: faellig }),
    ...extra,
  } as Record<string, Json>,
});

const rows = (e: Env): { feature_id: string; rule: string; due_at: string }[] =>
  e.ctx.db
    .prepare<{ feature_id: string; rule: string; due_at: string }>(
      'SELECT feature_id, rule, due_at FROM timers ORDER BY feature_id, rule',
    )
    .all();
const systemRuns = (e: Env, task: string): number =>
  e.ctx.db
    .prepare<{ n: number }>("SELECT count(*) AS n FROM runs WHERE actor_kind = 'system' AND task = ?")
    .get(task)?.n ?? 0;
const flagged = (e: Env, id: FeatureId): Json | undefined =>
  e.ctx.store.facts.feature(id)?.properties['kontrolle_faellig'];

describe('timers: elapsed rules', () => {
  it('schedules from the folded state: from + after + offset', () => {
    const e = env(withTimes([WARN]));
    e.ctx.seed([tree(1, '2026-04-01')]);
    e.timers.rebuild();
    expect(rows(e)).toEqual(
      [
        { feature_id: fid(101), rule: ELAPSED, due_at: '2026-04-01T00:00:00.000Z' },
        { feature_id: fid(101), rule: 'system_faellig.vorwarnung', due_at: '2026-03-18T00:00:00.000Z' },
      ].sort((a, b) => a.rule.localeCompare(b.rule)),
    );
  });

  it('a timer due at T fires exactly once at the first tick >= T, as a system run', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01')]);
    e.timers.rebuild();
    expect(e.timers.tick('2026-03-31T23:59:59.000Z')).toMatchObject({ fired: 0 });
    expect(flagged(e, fid(101))).toBe(false);

    expect(e.timers.tick('2026-04-01T00:00:00.000Z')).toEqual({
      fired: 1,
      refused: 0,
      skipped: 0,
      failed: 0,
    });
    expect(flagged(e, fid(101))).toBe(true);
    const run = e.ctx.db
      .prepare<{ actor: string; actor_kind: string; task: string; feature_id: string | null }>(
        "SELECT actor, actor_kind, task, json_extract(input, '$.feature') AS feature_id FROM runs WHERE task = 'system_faellig'",
      )
      .all();
    expect(run).toEqual([
      expect.objectContaining({ actor: 'system', actor_kind: 'system', task: 'system_faellig' }),
    ]);
    expect(rows(e).filter((r) => r.rule === ELAPSED)).toEqual([]);

    expect(e.timers.tick('2026-04-02T00:00:00.000Z')).toMatchObject({ fired: 0 });
    expect(systemRuns(e, 'system_faellig')).toBe(1);
  });

  it("a timer-fired run carries the tick's time, so changed_at reads it (WP-389)", () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01')]);
    e.timers.rebuild();
    e.clock.at = '2026-04-01T00:00:00.000Z'; // the tick time is the server clock (WP-762 clamps times ahead of it)
    e.timers.tick('2026-04-01T00:00:00.000Z');
    const newest = e.ctx.store.facts.history(fid(101), 'kontrolle_faellig', 1)[0];
    expect(newest?.result).toBe(true);
    expect(newest?.phenomenonTime).toBe('2026-04-01T00:00:00.000Z');
  });

  it('a late tick still fires it once', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01')]);
    e.timers.rebuild();
    expect(e.timers.tick('2026-06-01T12:00:00.000Z')).toMatchObject({ fired: 1 });
    expect(e.timers.tick('2026-06-01T12:00:00.000Z')).toMatchObject({ fired: 0 });
  });

  it('when is evaluated at firing time: false consumes the timer without a run', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01', { stage: 'erledigt' })]);
    e.timers.rebuild();
    expect(e.timers.tick('2026-04-02T00:00:00.000Z')).toEqual({
      fired: 0,
      refused: 0,
      skipped: 1,
      failed: 0,
    });
    expect(systemRuns(e, 'system_faellig')).toBe(0);
    expect(rows(e)).toEqual([]);
  });

  it('re-scheduling replaces: a run that changes the date moves the row, an unrelated edit leaves it', () => {
    const e = env();
    seedMusterstadt(e.ctx);
    e.timers.rebuild();
    const before = rows(e).filter((r) => r.feature_id === IDS.t_in);
    expect(before).toEqual([{ feature_id: IDS.t_in, rule: ELAPSED, due_at: '2026-04-01T00:00:00.000Z' }]);

    // an edit of another property: nothing the due date reads
    e.ctx.store.submit(e.ctx.run('befund_ergaenzen', anna, { befund: 'Pilz' }, IDS.t_in));
    expect(rows(e).filter((r) => r.feature_id === IDS.t_in)).toEqual(before);

    // the inspection sets faellig_am to today() + 12 months
    const r = e.ctx.store.submit(
      e.ctx.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'geprüft' }, IDS.t_in),
    );
    expect(r.outcome).toBe('accepted');
    expect(rows(e).filter((x) => x.feature_id === IDS.t_in)).toEqual([
      { feature_id: IDS.t_in, rule: ELAPSED, due_at: '2027-03-01T00:00:00.000Z' },
    ]);
  });

  it('scheduleFor replaces a stale row and removes it when there is no value any more', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01')]);
    e.ctx.db
      .prepare('INSERT INTO timers (feature_id, rule, due_at) VALUES (?, ?, ?)')
      .run(fid(101), ELAPSED, '2020-01-01T00:00:00.000Z');
    expect(e.timers.scheduleFor(fid(101), ELAPSED)).toBe('2026-04-01T00:00:00.000Z');
    expect(rows(e)).toHaveLength(1);
    expect(rows(e)[0]?.due_at).toBe('2026-04-01T00:00:00.000Z');

    e.ctx.seed([tree(2, null)]);
    e.ctx.db
      .prepare('INSERT INTO timers (feature_id, rule, due_at) VALUES (?, ?, ?)')
      .run(fid(102), ELAPSED, '2020-01-01T00:00:00.000Z');
    expect(e.timers.scheduleFor(fid(102), ELAPSED)).toBeUndefined();
    expect(rows(e).filter((r) => r.feature_id === fid(102))).toEqual([]);
    expect(e.timers.scheduleFor(fid(999), ELAPSED)).toBeUndefined();
  });

  it('a run that creates a feature schedules it in the same transaction', () => {
    const e = env();
    const r = e.ctx.store.submit(
      e.ctx.run('erfassen', anna, {
        geometrie: { type: 'Point', coordinates: [7.3, 50.9] },
        vitalitaet: 'v2',
      }),
    );
    expect(r.outcome).toBe('accepted');
    expect(rows(e)).toEqual([expect.objectContaining({ rule: ELAPSED, due_at: '2027-03-01T00:00:00.000Z' })]);
  });

  it.each(['deleted', 'archived'] as const)('a %s feature loses its timers, all of them', (state) => {
    const e = env(withTimes([WARN]));
    e.ctx.seed([tree(1, '2026-04-01'), tree(2, '2026-05-01')]);
    e.timers.rebuild();
    expect(rows(e)).toHaveLength(4);
    const gone = {
      ...(e.ctx.store.facts.feature(fid(101)) as object),
      lifecycle: state,
    } as FoldedFeature;
    e.timers.hook({
      db: e.ctx.db,
      config: plain,
      seq: { from: 1, to: 0 },
      runs: [],
      features: [gone],
    });
    expect(rows(e).map((r) => r.feature_id)).toEqual([fid(102), fid(102)]);
  });

  it('a feature deleted before its timer fires is skipped, and a rule that left the config is dropped', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01'), tree(2, '2026-04-01')]);
    e.timers.rebuild();
    e.ctx.db
      .prepare(
        "INSERT INTO timers (feature_id, rule, due_at) VALUES (?, 'verschwunden', '2026-01-01T00:00:00.000Z')",
      )
      .run(fid(101));
    e.ctx.seedObservations([
      { featureId: fid(101), property: '$lifecycle', result: 'deleted', seq: 1000, runId: 'seed' as never },
    ]);
    expect(e.timers.tick('2026-05-01T00:00:00.000Z')).toEqual({
      fired: 1,
      refused: 0,
      skipped: 2,
      failed: 0,
    });
    expect(flagged(e, fid(102))).toBe(true);
  });

  it('rebuild removes rows of rules the config no longer has', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01')]);
    e.ctx.db
      .prepare("INSERT INTO timers (feature_id, rule, due_at) VALUES (?, 'alt', '2030-01-01T00:00:00.000Z')")
      .run(fid(101));
    expect(e.timers.rebuild()).toBe(1);
    expect(rows(e).map((r) => r.rule)).toEqual([ELAPSED]);
  });

  it('a run that throws keeps its timer for the next tick and does not stop the others', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01'), tree(2, '2026-04-02')]);
    e.timers.rebuild();
    let armed = true;
    const flaky = createTimers(e.ctx.db, {
      clock: e.ctx.deps.clock,
      ids: e.ctx.deps.ids,
      geo: e.ctx.deps.geo,
      versions: {
        configFor: (v) => (v === 1 ? plain : undefined),
        deployed: () => ({ version: 1, config: plain }),
      },
      submit: (run) => {
        if (armed && run.featureId === fid(101)) throw new Error('disk full');
        return e.ctx.store.submit(run);
      },
      log,
    });
    expect(flaky.tick('2026-05-01T00:00:00.000Z')).toEqual({ fired: 1, refused: 0, skipped: 0, failed: 1 });
    expect(rows(e)).toEqual([{ feature_id: fid(101), rule: ELAPSED, due_at: '2026-04-01T00:00:00.000Z' }]);
    armed = false;
    expect(flaky.tick('2026-05-01T00:00:00.000Z')).toMatchObject({ fired: 1, failed: 0 });
    expect(rows(e)).toEqual([]);
  });

  it('a refused system run consumes the timer and leaves its refusal in the ledger', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01')]);
    e.timers.rebuild();
    const refusing = createTimers(e.ctx.db, {
      clock: e.ctx.deps.clock,
      ids: e.ctx.deps.ids,
      geo: e.ctx.deps.geo,
      versions: {
        configFor: (v) => (v === 1 ? plain : undefined),
        deployed: () => ({ version: 1, config: plain }),
      },
      submit: (run) => e.ctx.store.submit({ ...run, input: { unbekannt: 1 }, task: 'zuweisen' as Key }),
      log,
    });
    expect(refusing.tick('2026-05-01T00:00:00.000Z')).toMatchObject({ fired: 0, refused: 1 });
    expect(rows(e)).toEqual([]);
    expect(e.ctx.db.prepare("SELECT count(*) AS n FROM runs WHERE outcome = 'rejected'").get()).toEqual({
      n: 1,
    });
  });

  it('a reschedule between the tick read and its claim is not fired with the old due time', () => {
    const e = env();
    e.ctx.seed([tree(1, '2026-04-01')]);
    e.timers.rebuild();
    // the row changes after `tick` selected it: emulate through a statement wrapper on the same connection
    const real = e.ctx.db.prepare.bind(e.ctx.db);
    let moved = false;
    e.ctx.db.prepare = ((sql: string) => {
      const st = real(sql);
      if (!sql.startsWith('SELECT feature_id, rule, due_at, config_version FROM timers')) return st;
      return {
        ...st,
        all: (...p: never[]) => {
          const rowsNow = st.all(...p);
          if (!moved) {
            moved = true;
            e.timers.scheduleFor(fid(101), ELAPSED);
            e.ctx.db.exec("UPDATE timers SET due_at = '2027-01-01T00:00:00.000Z'");
          }
          return rowsNow;
        },
      };
    }) as never;
    const late = createTimers(e.ctx.db, {
      clock: e.ctx.deps.clock,
      ids: e.ctx.deps.ids,
      geo: e.ctx.deps.geo,
      versions: {
        configFor: (v) => (v === 1 ? plain : undefined),
        deployed: () => ({ version: 1, config: plain }),
      },
      submit: (run) => e.ctx.store.submit(run),
      log,
    });
    expect(late.tick('2026-05-01T00:00:00.000Z')).toEqual({ fired: 0, refused: 0, skipped: 0, failed: 0 });
    expect(rows(e)).toEqual([{ feature_id: fid(101), rule: ELAPSED, due_at: '2027-01-01T00:00:00.000Z' }]);
  });

  it('property: a tick fires exactly the timers due at `now`, once each, oldest first', () => {
    const day = fc
      .integer({ min: 0, max: 364 })
      .map((d) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString());
    fc.assert(
      fc.property(fc.array(day, { minLength: 1, maxLength: 6 }), day, (dues, now) => {
        const e = env();
        e.ctx.seed(dues.map((d, i) => tree(i, d.slice(0, 10))));
        e.timers.rebuild();
        const expected = dues.filter((d) => d.slice(0, 10) <= now.slice(0, 10)).length;
        const first = e.timers.tick(now);
        expect(first.fired).toBe(expected);
        expect(e.timers.tick(now)).toEqual({ fired: 0, refused: 0, skipped: 0, failed: 0 });
        expect(systemRuns(e, 'system_faellig')).toBe(expected);
        expect(rows(e)).toHaveLength(dues.length - expected);
      }),
      { numRuns: 25 },
    );
  });
});

describe('timers: schedule rules', () => {
  it('syncSchedules adds one row for the rule, the next matching time', () => {
    const e = env();
    expect(e.timers.syncSchedules()).toBe(1);
    expect(e.timers.syncSchedules()).toBe(0);
    expect(rows(e)).toEqual([
      { feature_id: '', rule: 'nachtlauf.taeglich', due_at: '2026-03-02T06:00:00.000Z' },
    ]);
  });

  it('fires as a system run without a feature and moves to the next day', () => {
    const e = env();
    e.timers.syncSchedules();
    expect(e.timers.tick('2026-03-02T06:00:00.000Z')).toMatchObject({ fired: 1 });
    expect(systemRuns(e, 'nachtlauf')).toBe(1);
    expect(rows(e)).toEqual([
      { feature_id: '', rule: 'nachtlauf.taeglich', due_at: '2026-03-03T06:00:00.000Z' },
    ]);
    // a tick days later fires once, not once per missed day
    expect(e.timers.tick('2026-03-09T07:00:00.000Z')).toMatchObject({ fired: 1 });
    expect(e.timers.tick('2026-03-09T07:00:00.000Z')).toMatchObject({ fired: 0 });
    expect(rows(e)[0]?.due_at).toBe('2026-03-10T06:00:00.000Z');
    expect(systemRuns(e, 'nachtlauf')).toBe(2);
  });
});
