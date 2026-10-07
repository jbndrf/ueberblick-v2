// WP-318 (A-029): timers work per effective version; a row records the version it was scheduled under.
import { describe, expect, it } from 'vitest';
import { RESERVED_VERSION, type CompiledConfig, type FeatureId, type Json, type Key } from '@ueberblick/core';
import {
  build,
  fid,
  golden,
  headSeq,
  markDeployed,
  rid,
  setup,
  withAuto,
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
const ELAPSED_NAME = 'kontrolle_wird_faellig';
const ruleOf = (extra: Record<string, unknown>) => ({
  ...(base.tasks?.['system_faellig']?.auto?.[ELAPSED_NAME] as Record<string, unknown>),
  ...extra,
});
/** The golden project with the elapsed action replaced (`elapsed`), plus schedules on `nachtlauf`, or without it. */
const config = (
  elapsed: Record<string, unknown> | undefined,
  schedules: Record<string, Record<string, unknown>> = {},
  without = false,
): CompiledConfig =>
  build(
    withAuto(
      base,
      [
        ...(elapsed === undefined ? [] : [['system_faellig', ELAPSED_NAME, elapsed] as const]),
        ...Object.entries(schedules).map(([k, entry]) => ['nachtlauf', k, entry] as const),
      ],
      without ? [['system_faellig', ELAPSED_NAME]] : [],
      { nachtlauf: NIGHT },
    ),
  );

// v1: due at faellig_am. v2: 14 days earlier, and its `when` is never true. v3: the rule is gone.
const v1 = config(undefined);
const v2 = config(ruleOf({ elapsed: { from: 'self.faellig_am', offset: '-days(14)' }, when: 'false' }));
const v3 = config(undefined, { taeglich: { schedule: '0 6 * * *' } }, true);

interface World {
  readonly ctx: Ctx;
  readonly timers: Timers;
  readonly resolved: number[];
  deploy(version: number): void;
  deployedConfig(): CompiledConfig;
}

function world(deployed = 2): World {
  const state = { deployed };
  const resolved: number[] = [];
  const all = new Map<number, CompiledConfig>([
    [1, v1],
    [2, v2],
    [3, v3],
  ]);
  const holder: { t?: Timers } = {};
  const ctx = setup({
    config: v1,
    version: 1,
    configs: new Map([
      [2, v2],
      [3, v3],
    ]),
    deployed,
    hooks: [(c) => (holder.t as Timers).hook(c)],
  });
  const timers = createTimers(ctx.db, {
    clock: ctx.deps.clock,
    ids: ctx.deps.ids,
    geo: ctx.deps.geo,
    versions: {
      configFor: (v) => {
        resolved.push(v);
        return all.get(v);
      },
      deployed: () => ({ version: state.deployed, config: all.get(state.deployed) as CompiledConfig }),
    },
    submit: (run) => ctx.store.submit(run),
    log,
  });
  holder.t = timers;
  return {
    ctx,
    timers,
    resolved,
    deployedConfig: () => all.get(state.deployed) as CompiledConfig,
    deploy(version) {
      state.deployed = version;
      markDeployed(ctx.db, version);
    },
  };
}

const props = (n: number, faellig: string): Record<string, Json> => ({
  geometrie: { type: 'Point', coordinates: [7.2 + n / 1000, 50.8] },
  stage: 'erfasst',
  kontrolle_faellig: false,
  faellig_am: faellig,
});
const plant = (w: World, n: number, faellig: string, pin?: number): FeatureId => {
  w.ctx.seed([{ id: fid(n), type: 'baum', properties: props(n, faellig) }]);
  if (pin !== undefined) pinTo(w, fid(n), pin);
  return fid(n);
};
const pinTo = (w: World, id: FeatureId, pin: number | null): void =>
  w.ctx.seedObservations([
    { featureId: id, property: RESERVED_VERSION, result: pin, seq: headSeq(w.ctx.db) + 1, runId: rid(1) },
  ]);

interface Row {
  feature_id: string;
  rule: string;
  due_at: string;
  config_version: number | null;
}
const rows = (w: World): Row[] =>
  w.ctx.db
    .prepare<Row>('SELECT feature_id, rule, due_at, config_version FROM timers ORDER BY feature_id, rule')
    .all();
const flagged = (w: World, id: FeatureId): Json | undefined =>
  w.ctx.store.facts.feature(id)?.properties['kontrolle_faellig'];
/** What a pin run's hook sees: the run wrote `$version` on the feature. */
const hookAfterPin = (w: World, id: FeatureId): void => {
  const f = w.ctx.store.facts.feature(id);
  if (f === undefined) throw new Error('no feature');
  w.timers.hook({
    db: w.ctx.db,
    config: w.deployedConfig(),
    seq: { from: 0, to: 0 },
    runs: [
      { observations: [{ featureId: id, property: RESERVED_VERSION, result: f.pinnedVersion ?? null }] },
    ],
    features: [{ ...f, derived: {} }],
  } as never);
};

describe('timers per version: scheduling', () => {
  it('a pinned feature is scheduled with its pinned version, a floating one with the deployed one', () => {
    const w = world(2);
    plant(w, 1, '2026-04-01', 1);
    plant(w, 2, '2026-04-01');
    w.timers.rebuild();
    expect(rows(w)).toEqual([
      { feature_id: fid(1), rule: ELAPSED, due_at: '2026-04-01T00:00:00.000Z', config_version: 1 },
      { feature_id: fid(2), rule: ELAPSED, due_at: '2026-03-18T00:00:00.000Z', config_version: 2 },
    ]);
  });

  it('scheduleFor uses the version of the feature', () => {
    const w = world(2);
    plant(w, 1, '2026-04-01', 1);
    expect(w.timers.scheduleFor(fid(1), ELAPSED)).toBe('2026-04-01T00:00:00.000Z');
    expect(rows(w)[0]?.config_version).toBe(1);
  });

  it('a pin run reschedules the rows under the new version, an unpin under the deployed one', () => {
    const w = world(2);
    const id = plant(w, 1, '2026-04-01');
    w.timers.rebuild();
    expect(rows(w)[0]).toMatchObject({ due_at: '2026-03-18T00:00:00.000Z', config_version: 2 });
    pinTo(w, id, 1);
    hookAfterPin(w, id);
    expect(rows(w)).toEqual([
      { feature_id: id, rule: ELAPSED, due_at: '2026-04-01T00:00:00.000Z', config_version: 1 },
    ]);
    pinTo(w, id, null);
    hookAfterPin(w, id);
    expect(rows(w)[0]).toMatchObject({ due_at: '2026-03-18T00:00:00.000Z', config_version: 2 });
  });

  it('a pin to a version without the rule drops the row; an unpin brings it back', () => {
    const w = world(2);
    const id = plant(w, 1, '2026-04-01');
    w.timers.rebuild();
    pinTo(w, id, 3);
    hookAfterPin(w, id);
    expect(rows(w)).toEqual([]);
    pinTo(w, id, null);
    hookAfterPin(w, id);
    expect(rows(w)).toHaveLength(1);
  });
});

describe('timers per version: firing', () => {
  it('fires a pinned feature with its version`s when and stamps its version; the floating one is skipped by v2`s when', () => {
    const w = world(2);
    const pinned = plant(w, 1, '2026-03-01', 1);
    const floating = plant(w, 2, '2026-03-14');
    w.timers.rebuild();
    const r = w.timers.tick('2026-03-14T00:00:00.000Z');
    expect(r).toEqual({ fired: 1, refused: 0, skipped: 1, failed: 0 });
    expect(flagged(w, pinned)).toBe(true);
    expect(flagged(w, floating)).toBe(false);
    const stamps = w.ctx.db
      .prepare<{ config_version: number }>("SELECT config_version FROM runs WHERE actor_kind = 'system'")
      .all();
    expect(stamps).toEqual([{ config_version: 1 }]);
  });

  it('a floating feature follows each deploy: rows are rebuilt under the new version', () => {
    const w = world(1);
    const id = plant(w, 1, '2026-04-01');
    w.timers.rebuild();
    expect(rows(w)[0]).toMatchObject({ due_at: '2026-04-01T00:00:00.000Z', config_version: 1 });
    w.deploy(2);
    w.timers.rebuild();
    expect(rows(w)).toEqual([
      { feature_id: id, rule: ELAPSED, due_at: '2026-03-18T00:00:00.000Z', config_version: 2 },
    ]);
  });

  it('a deploy between schedule and tick reschedules the stale row instead of firing it', () => {
    const w = world(1);
    const id = plant(w, 1, '2026-03-01');
    w.timers.rebuild();
    w.deploy(2); // no rebuild yet: the row still says version 1
    expect(w.timers.tick('2026-04-01T00:00:00.000Z')).toEqual({
      fired: 0,
      refused: 0,
      skipped: 1,
      failed: 0,
    });
    expect(flagged(w, id)).toBe(false);
    expect(rows(w)).toEqual([
      { feature_id: id, rule: ELAPSED, due_at: '2026-02-15T00:00:00.000Z', config_version: 2 },
    ]);
  });

  it('a deploy that removes the rule drops the floating rows and keeps the pinned ones', () => {
    const w = world(2);
    plant(w, 1, '2026-04-01', 1);
    plant(w, 2, '2026-04-01');
    w.timers.rebuild();
    expect(rows(w)).toHaveLength(2);
    w.deploy(3);
    w.timers.rebuild();
    expect(rows(w)).toEqual([
      { feature_id: fid(1), rule: ELAPSED, due_at: '2026-04-01T00:00:00.000Z', config_version: 1 },
    ]);
  });

  it('schedule rules stay on the deployed version', () => {
    const w = world(3);
    w.timers.syncSchedules();
    expect(rows(w)).toEqual([
      { feature_id: '', rule: 'nachtlauf.taeglich', due_at: '2026-05-02T06:00:00.000Z', config_version: 3 },
    ]);
    // pinned features of version 1 do not move it
    plant(w, 1, '2026-04-01', 1);
    w.timers.rebuild();
    expect(rows(w).filter((r) => r.feature_id === '')).toHaveLength(1);
  });

  it('a pinned version that is gone is an error, not a fallback to the deployed config (R11)', () => {
    const w = world(2);
    const id = plant(w, 1, '2026-03-01', 1);
    w.timers.rebuild();
    pinTo(w, id, 9);
    expect(w.timers.tick('2026-04-01T00:00:00.000Z')).toMatchObject({ fired: 0, failed: 1 });
    expect(flagged(w, id)).toBe(false);
  });
});

describe('timers per version: warnings', () => {
  it('a dropped schedule rule warns once per rule per version, across versions', () => {
    const never = config(undefined, { nie: { schedule: '0 0 31 2 *' } });
    const out: string[] = [];
    const lg = createLogger({ sink: (l) => out.push(l), now: () => 0 });
    const state = { v: 1 };
    const ctx = setup({ config: never, version: 1, configs: new Map([[2, never]]) });
    const timers = createTimers(ctx.db, {
      clock: ctx.deps.clock,
      ids: ctx.deps.ids,
      geo: ctx.deps.geo,
      versions: {
        configFor: () => never,
        deployed: () => ({ version: state.v, config: never }),
      },
      submit: (run) => ctx.store.submit(run),
      log: lg,
    });
    timers.syncSchedules();
    timers.syncSchedules();
    state.v = 2;
    timers.syncSchedules();
    state.v = 1;
    timers.syncSchedules();
    expect(out).toHaveLength(2);
  });
});
