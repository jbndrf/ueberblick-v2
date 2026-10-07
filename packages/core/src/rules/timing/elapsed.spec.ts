// WP-573: time rules of a compiled config, and when an elapsed rule is due.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { EvalContext, EvalValue } from '../../expr';
import { compile } from '../../schema/compile';
import { TemplateFileSchema } from '../../schema/file';
import { createGeo } from '../../geo';
import type { FeatureId, Json, Key } from '../../model';
import { elapsedDueAt, nextRun, timeRules } from './index';
import { goldenAssets } from '../../testing/golden';
import { addAuto } from '../../plan/__fixtures__/auto';

const golden = import.meta.glob('/fixtures/golden/templates/veranstaltung/1.0.0.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The golden Veranstaltung plus automatic actions on `erinnern`: name to entry. */
function configWith(extra: Record<string, Record<string, unknown>> = {}) {
  const file = parse(Object.values(golden)[0] as string) as Record<string, Record<string, unknown>>;
  for (const [name, entry] of Object.entries(extra)) addAuto(file, 'erinnern', name, entry);
  const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

const ID = 'feat-1' as FeatureId;
const ctxOf = (
  props: Record<string, Json>,
  inputs: Record<string, Json> = { erinnerung_tage: 14 },
): EvalContext => ({
  vars: new Map<string, EvalValue>([
    ['self', { $feature: ID }],
    ['inputs', inputs],
  ]),
  features: {
    property: (id, key) => (id === ID ? props[key] : undefined),
    related: () => [],
    history: () => [],
    type: () => 'veranstaltung' as Key,
  },
  now: '2026-06-01T00:00:00.000Z',
  relations: new Map(),
  geo: createGeo(),
});

describe('timeRules', () => {
  const config = configWith({
    nach_zeit: { elapsed: { from: 'self.datum', after: 'days(2)', offset: 'months(-1)' } },
    nachts: { schedule: '0 3 * * *', idle: 'days(1)' },
  });
  const rules = timeRules(config);

  it('lists elapsed rules by feature type and schedule rules by key', () => {
    expect([...rules.elapsed.keys()].sort()).toEqual([
      'erinnern.erinnerung_vor_beginn',
      'erinnern.nach_zeit',
    ]);
    expect(
      rules.byType
        .get('veranstaltung')
        ?.map((r) => r.key)
        .sort(),
    ).toEqual(['erinnern.erinnerung_vor_beginn', 'erinnern.nach_zeit']);
    expect([...rules.schedules.keys()]).toEqual(['erinnern.nachts']);
  });

  it('a bad cron (only in a hand-built config) throws an invariant error naming the rule key', () => {
    const hand = configWith({ kaputt: { schedule: '0 3 * * *', idle: 'days(1)' } });
    const rule = hand.file.tasks?.['erinnern']?.auto?.['kaputt'] as { schedule: string };
    rule.schedule = '61 3 * * *';
    expect(() => timeRules(hand)).toThrow(/kaputt/);
  });

  it('an elapsed rule whose expression is missing from the compiled config throws, naming the rule key', () => {
    const hand = configWith();
    (hand.expressions as Map<string, unknown>).delete(
      'tasks.erinnern.auto.erinnerung_vor_beginn.elapsed.from',
    );
    expect(() => timeRules(hand)).toThrow(/erinnerung_vor_beginn/);
  });

  it('is computed once per config', () => {
    expect(timeRules(config)).toBe(rules);
  });

  it('reads: the properties of self the expressions read', () => {
    expect([...(rules.elapsed.get('erinnern.erinnerung_vor_beginn')?.reads ?? [])]).toEqual(['datum']);
  });

  it('nextRun is the next cron time after `from`', () => {
    const s = rules.schedules.get('erinnern.nachts');
    expect(s && nextRun(s, '2026-05-01T03:00:00.000Z')).toBe('2026-05-02T03:00:00.000Z');
  });
});

describe('elapsedDueAt', () => {
  const config = configWith({
    nach_zeit: { elapsed: { from: 'self.datum', after: 'days(2)', offset: 'months(-1)' } },
  });
  const rules = timeRules(config);
  const golden = rules.elapsed.get('erinnern.erinnerung_vor_beginn');
  const variant = rules.elapsed.get('erinnern.nach_zeit');

  it('erinnerung_vor_beginn: from self.datum, offset -days(inputs.erinnerung_tage)', () => {
    if (!golden) throw new Error('rule missing');
    expect(elapsedDueAt(golden, ctxOf({ datum: '2026-07-01T09:00:00.000Z' }))).toBe(
      '2026-06-17T09:00:00.000Z',
    );
    expect(elapsedDueAt(golden, ctxOf({ datum: '2026-07-01T09:00:00.000Z' }, { erinnerung_tage: 3 }))).toBe(
      '2026-06-28T09:00:00.000Z',
    );
  });

  it('a negative offset moves the due time before `from`; a date `from` counts as midnight UTC', () => {
    if (!golden) throw new Error('rule missing');
    const due = elapsedDueAt(golden, ctxOf({ datum: '2026-07-01' }));
    expect(due).toBe('2026-06-17T00:00:00.000Z');
    expect(Date.parse(due as string)).toBeLessThan(Date.parse('2026-07-01'));
  });

  it('a missing `from` value has no due time', () => {
    if (!golden) throw new Error('rule missing');
    expect(elapsedDueAt(golden, ctxOf({}))).toBeUndefined();
    expect(elapsedDueAt(golden, ctxOf({ datum: null }))).toBeUndefined();
  });

  it('a value that is no timestamp has no due time (evaluation is total)', () => {
    if (!golden) throw new Error('rule missing');
    expect(elapsedDueAt(golden, ctxOf({ datum: 'bald' }))).toBeUndefined();
  });

  it('after and offset add up, calendar months clamp to month end', () => {
    if (!variant) throw new Error('rule missing');
    // 31 Mar - 1 month = 28 Feb (2026), then + 2 days = 2 Mar
    expect(elapsedDueAt(variant, ctxOf({ datum: '2026-03-31T00:00:00.000Z' }))).toBe(
      '2026-03-02T00:00:00.000Z',
    );
  });
});

describe('an edge trigger is not a timer (WP-438)', () => {
  it('an automatic action without a timing is neither an elapsed nor a schedule rule, and timeRules does not throw', () => {
    const config = configWith({ wenn_bedingung: { when: "self.status == 'in_pruefung'" } });
    const rules = timeRules(config);
    expect(rules.elapsed.has('erinnern.wenn_bedingung')).toBe(false);
    expect(rules.schedules.has('erinnern.wenn_bedingung')).toBe(false);
    expect(rules.elapsed.has('erinnern.erinnerung_vor_beginn')).toBe(true);
  });
});
