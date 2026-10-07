// WP-574: compile refuses an unparseable `schedule` cron at tasks.<task>.auto.<name>.schedule, with the parser position.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile as compileWith } from './index';
import { TemplateFileSchema, type TemplateFile } from '../file';
import { parseCron } from '../../rules/timing/cron';
import { timeRules } from '../../rules/timing';
import { goldenAssets } from '../../testing/golden';
/** Compiles with the golden bundle, so `$ref` layer styles resolve (WP-577). */
const compile = (f: Parameters<typeof compileWith>[0]) => compileWith(f, { assets: goldenAssets });

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const golden = import.meta.glob('/fixtures/golden/templates/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The base file with the automatic action `taeglich` on `kontrolle` (a sweep: `idle` gives the schedule its subjects). */
const withEntry = (entry: unknown): TemplateFile => {
  const f = parse(Object.values(raw)[0] as string) as {
    tasks: Record<string, { auto?: Record<string, unknown> }>;
  };
  (f.tasks['kontrolle'] as { auto?: Record<string, unknown> }).auto = { taeglich: entry };
  return TemplateFileSchema.parse(f);
};
const withSchedule = (schedule: string): TemplateFile => withEntry({ schedule, idle: 'days(1)' });

describe('file schema: schedule shape', () => {
  it.each(['0 6 * *', 'jeden Tag', ''])(
    'refuses %j before compile, at tasks.<task>.auto.<name>.schedule',
    (bad) => {
      const f = parse(Object.values(raw)[0] as string) as { tasks: Record<string, Record<string, unknown>> };
      (f.tasks['kontrolle'] as Record<string, unknown>)['auto'] = { taeglich: { schedule: bad } };
      const r = TemplateFileSchema.safeParse(f);
      expect(r.success).toBe(false);
      if (!r.success)
        expect(
          r.error.issues.some((i) => i.path.join('.').startsWith('tasks.kontrolle.auto.taeglich.schedule')),
        ).toBe(true);
    },
  );
});

describe('compile: schedule', () => {
  it.each(['61 6 * * *', '0 24 * * *', '0 6 32 * *', '0 6 * 13 *', '*/0 * * * *', '5-1 * * * *'])(
    'refuses %j with path and position',
    (bad) => {
      const parsed = parseCron(bad);
      expect(parsed.ok).toBe(false);
      const r = compile(withSchedule(bad));
      expect(r.ok).toBe(false);
      if (r.ok || parsed.ok) return;
      const p = r.problems.find((x) => x.path === 'tasks.kontrolle.auto.taeglich.schedule');
      expect(p?.code).toBe('expression_parse');
      expect(p?.message).toContain(parsed.error.message);
      expect(p?.span?.start).toBe(parsed.error.position);
    },
  );

  it('accepts a valid cron and keeps it usable', () => {
    const r = compile(withSchedule('0 6 * * *'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t = timeRules(r.config);
      expect(t.schedules.has('kontrolle.taeglich')).toBe(true);
    }
  });

  it('refuses a schedule without idle on a task offered on a type: no subject', () => {
    const r = compile(withEntry({ schedule: '0 6 * * *' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const p = r.problems.find((x) => x.code === 'auto_schedule_without_idle');
      expect(p?.path).toBe('tasks.kontrolle.auto.taeglich.schedule');
    }
  });

  it('every golden config that compiles yields timeRules without throwing', () => {
    let seen = 0;
    for (const src of Object.values(golden)) {
      const f = TemplateFileSchema.safeParse(parse(src as string));
      if (!f.success) continue;
      const r = compile(f.data);
      if (!r.ok) continue;
      seen++;
      expect(() => timeRules(r.config)).not.toThrow();
    }
    expect(seen).toBeGreaterThan(0);
  });
});
