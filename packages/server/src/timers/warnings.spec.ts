import { describe, expect, it } from 'vitest';
import type { CompiledConfig, TemplateFile } from '@ueberblick/core';
import { deploy, plan } from '../deploy';
import { openProjectDb } from '../db/open';
import { createLogger } from '../log';
import { build, golden, setup, withAuto } from '../store/run/testkit';
import { createTimers, SCHEDULE_SUBJECT } from './index';
import { TIMER_WARNING_CODES } from './warnings';

const base = golden('musterstadt-plain').file;
const NIGHT = { label: { de: 'Nachtlauf' }, on: '$none', when: "actor.kind == 'system'" } as const;
const NEVER = '0 0 31 2 *';
const clock = { now: () => '2026-03-01T08:00:00.000Z' };

const withSchedules = (schedules: Record<string, string>): TemplateFile =>
  withAuto(
    base,
    Object.entries(schedules).map(([k, cron]) => ['nachtlauf', k, { schedule: cron }] as const),
    [],
    { nachtlauf: NIGHT },
  );

describe('deploy and plan: schedules past the horizon', () => {
  it('a never-matching cron deploys with a warning naming the rule and the reason', () => {
    const file = withSchedules({ taeglich: '0 6 * * *', nie: NEVER });
    const db = openProjectDb(':memory:', 'p');
    const p = plan(db, file, { clock });
    expect(p.ok && p.warnings).toEqual([
      expect.objectContaining({ path: 'tasks.nachtlauf.auto.nie.schedule', code: 'schedule_never_runs' }),
    ]);
    const d = deploy(db, file, 'admin-1', { clock });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.warnings).toHaveLength(1);
      expect(String(d.warnings[0]?.message)).toContain(NEVER);
    }
  });

  it('a project without such a schedule has no warnings', () => {
    const db = openProjectDb(':memory:', 'p');
    const d = deploy(db, withSchedules({ taeglich: '0 6 * * *' }), 'admin-1', { clock });
    expect(d.ok && d.warnings).toEqual([]);
  });

  it('codes are a registry', () => {
    expect(TIMER_WARNING_CODES.keys).toContain('schedule_never_runs');
  });
});

describe('timers: one warn per dropped rule per version', () => {
  const setupTimers = (config: CompiledConfig, version: { v: number }) => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l), now: () => 0 });
    const ctx = setup({ config, clock });
    const timers = createTimers(ctx.db, {
      clock: ctx.deps.clock,
      ids: ctx.deps.ids,
      geo: ctx.deps.geo,
      versions: {
        configFor: (v) => (v === version.v ? config : undefined),
        deployed: () => ({ version: version.v, config }),
      },
      submit: (run) => ctx.store.submit(run),
      log,
    });
    return { ctx, timers, lines };
  };
  const config = build(withSchedules({ taeglich: '0 6 * * *', nie: NEVER }) as never);

  it('syncSchedules warns once per rule, not on every tick', () => {
    const v = { v: 1 };
    const { timers, lines } = setupTimers(config, v);
    timers.syncSchedules();
    timers.syncSchedules();
    timers.syncSchedules();
    const warns = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      level: 'warn',
      event: 'timer.dropped',
      ruleId: 'nachtlauf.nie',
      code: 'schedule_never_runs',
    });
    v.v = 2;
    timers.syncSchedules();
    expect(lines).toHaveLength(2);
  });

  it('the re-schedule after a fire warns once too', () => {
    const v = { v: 1 };
    const { ctx, timers, lines } = setupTimers(config, v);
    ctx.db
      .prepare('INSERT INTO timers (feature_id, rule, due_at) VALUES (?, ?, ?)')
      .run(SCHEDULE_SUBJECT, 'nachtlauf.nie', '2026-03-01T00:00:00.000Z');
    timers.tick('2026-03-01T08:00:00.000Z');
    timers.syncSchedules();
    expect(lines).toHaveLength(1);
  });
});
