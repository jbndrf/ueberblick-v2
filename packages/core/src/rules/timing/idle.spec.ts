// WP-469: the idle sweep, `schedule` with `idle`: compile checks `idle`, and one function decides "idle enough".
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { EvalContext } from '../../expr';
import { compile } from '../../schema/compile';
import { TemplateFileSchema } from '../../schema/file';
import { createGeo } from '../../geo';
import { idleCutoffMs, idleEnough, timeRules } from './index';
import { goldenAssets } from '../../testing/golden';
import { addAuto } from '../../plan/__fixtures__/auto';

const golden = import.meta.glob('/fixtures/golden/templates/veranstaltung/1.0.0.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function compiled(extra: Record<string, Record<string, unknown>>) {
  const file = parse(Object.values(golden)[0] as string) as Record<string, Record<string, unknown>>;
  for (const [name, entry] of Object.entries(extra)) addAuto(file, 'erinnern', name, entry);
  return compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
}

const NOW = '2026-06-01T00:00:00.000Z';
const ctx = (now = NOW): EvalContext => ({
  vars: new Map(),
  features: { property: () => undefined, related: () => [], history: () => [], type: () => undefined },
  now,
  relations: new Map(),
  geo: createGeo(),
});

const sweep = (idle: string) => {
  const r = compiled({ ruhig: { schedule: '0 2 * * *', idle } });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  const rule = timeRules(r.config).schedules.get('erinnern.ruhig');
  if (rule === undefined) throw new Error('no rule');
  return rule;
};

describe('compile: schedule idle', () => {
  it("is a duration over the task's Objektart and is stored by key path", () => {
    const rule = sweep('days(7)');
    expect(rule.idle?.source).toBe('days(7)');
    expect(rule.types).toEqual(['veranstaltung']);
  });

  it('refuses an idle that is not a duration', () => {
    const r = compiled({ ruhig: { schedule: '0 2 * * *', idle: "'sieben'" } });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(
        r.problems.some((p) => p.path === 'tasks.erinnern.auto.ruhig.idle' && p.code === 'expression_type'),
      ).toBe(true);
  });
});

describe('idleEnough', () => {
  const rule = sweep('days(7)');
  const DAY = 86_400_000;

  it('fires from exactly N days after the last change', () => {
    const at = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();
    expect(idleEnough(rule, at(7), ctx())).toBe(true);
    expect(idleEnough(rule, at(30), ctx())).toBe(true);
    expect(idleEnough(rule, at(6.9), ctx())).toBe(false);
    expect(idleEnough(rule, at(0), ctx())).toBe(false);
  });

  it('an Objekt with no last change is not idle enough', () => {
    expect(idleEnough(rule, undefined, ctx())).toBe(false);
  });

  it('property: idle enough exactly when changedAt <= now - idle, and the prefilter never excludes one', () => {
    const cutoff = idleCutoffMs(rule, ctx()) as number;
    expect(cutoff).toBe(Date.parse(NOW) - 7 * DAY);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 * DAY }), (age) => {
        const changed = new Date(Date.parse(NOW) - age).toISOString();
        const enough = idleEnough(rule, changed, ctx());
        expect(enough).toBe(age >= 7 * DAY);
        if (enough) expect(Date.parse(changed)).toBeLessThanOrEqual(cutoff);
      }),
    );
  });

  it('months idle has no database prefilter (the check per Objekt decides)', () => {
    const m = sweep('months(1)');
    expect(idleCutoffMs(m, ctx())).toBeUndefined();
    expect(idleEnough(m, '2026-04-30T00:00:00.000Z', ctx())).toBe(true);
    expect(idleEnough(m, '2026-05-15T00:00:00.000Z', ctx())).toBe(false);
  });
});
