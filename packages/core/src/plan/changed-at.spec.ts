// WP-389 / A-038: `changed_at('prop')` is the time the newest observation of one property carries. An elapsed rule on the
// stage fires after the stage changed, not after another property changed; misuse is a compile problem.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { EvalContext, EvalValue } from '../expr';
import { createGeo } from '../geo';
import type { FeatureId, Key, RecordedObservation, RunId } from '../model';
import { elapsedDueAt, timeRules } from '../rules/timing';
import { compile } from '../schema/compile';
import { TemplateFileSchema } from '../schema/file';
import { goldenAssets } from '../testing/golden';
import { addAuto } from './__fixtures__/auto';

const golden = import.meta.glob('/fixtures/golden/templates/veranstaltung/1.0.0.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function compileWith(entry: Record<string, unknown>) {
  const file = parse(Object.values(golden)[0] as string) as Record<string, Record<string, unknown>>;
  addAuto(file, 'erinnern', 'seit_phase', entry);
  return compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
}

const ID = 'feat-1' as FeatureId;
const obs = (property: string, seq: number, at: string | undefined): RecordedObservation => ({
  featureId: ID,
  property,
  result: 'x',
  seq,
  runId: 'r' as RunId,
  ...(at === undefined ? {} : { phenomenonTime: at }),
});

/** `history` is newest first, like the Facts port. */
const ctxOf = (history: Record<string, readonly RecordedObservation[]>): EvalContext => ({
  vars: new Map<string, EvalValue>([['self', { $feature: ID }]]),
  features: {
    property: () => undefined,
    related: () => [],
    history: (_id, p, limit) => (history[p] ?? []).slice(0, limit),
    type: () => 'veranstaltung' as Key,
  },
  now: '2026-06-01T00:00:00.000Z',
  relations: new Map(),
  geo: createGeo(),
});

const RULE = { elapsed: { from: "changed_at('status')", after: 'days(3)' } };

describe('changed_at in an elapsed rule', () => {
  const r = compileWith(RULE);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  const rule = timeRules(r.config).elapsed.get('erinnern.seit_phase');
  if (rule === undefined) throw new Error('rule missing');

  it('is due 3 days after the stage changed, not after another property changed', () => {
    const ctx = ctxOf({
      status: [obs('status', 5, '2026-05-10T08:00:00.000Z'), obs('status', 1, '2026-05-01T08:00:00.000Z')],
      kollision: [obs('kollision', 9, '2026-05-30T08:00:00.000Z')],
    });
    expect(elapsedDueAt(rule, ctx)).toBe('2026-05-13T08:00:00.000Z');
  });

  it('has no due time while the property has no observation or the run carried no time', () => {
    expect(elapsedDueAt(rule, ctxOf({}))).toBeUndefined();
    expect(elapsedDueAt(rule, ctxOf({ status: [obs('status', 1, undefined)] }))).toBeUndefined();
  });

  it('reads the property it names, so its change moves the timer', () => {
    expect([...(rule.reads ?? [])]).toEqual(['status']);
  });

  it('is generic: any property of the type, anywhere in the expression', () => {
    const other = compileWith({
      elapsed: { from: 'self.datum', after: "changed_at('kollision') - self.datum" },
    });
    expect(other.ok).toBe(true);
  });

  it('property: the due time is always the newest observation time plus the delay', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 8 }), (hours) => {
        const sorted = [...hours].sort((a, b) => a - b);
        const at = (h: number) => new Date(Date.UTC(2026, 0, 1) + h * 3_600_000).toISOString();
        const history = sorted.map((h, i) => obs('status', i + 1, at(h))).reverse();
        const due = elapsedDueAt(rule, ctxOf({ status: history }));
        expect(due).toBe(at((sorted[sorted.length - 1] as number) + 72));
      }),
    );
  });
});

describe('compile: changed_at misuse', () => {
  it('an unknown property is a problem with a registry code and a hint', () => {
    const r = compileWith({ elapsed: { from: "changed_at('nope')", after: 'days(3)' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const p = r.problems.find((x) => JSON.stringify(x.path).includes('seit_phase'));
    expect(p?.code).toBe('expression_type');
    expect(p?.message).toContain("unknown property 'nope'");
  });

  it('a non-literal argument and a wrong result type are problems', () => {
    expect(compileWith({ elapsed: { from: 'changed_at(self.status)' } }).ok).toBe(false);
    expect(compileWith({ elapsed: { from: "days(changed_at('status'))" } }).ok).toBe(false);
  });
});
