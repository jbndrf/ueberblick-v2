import { describe, expect, it } from 'vitest';
import { goldenDoc } from '../process/fixtures';
import { buildRules } from './model';

const doc = () => goldenDoc('baumkataster', '2.0.0');
const FIRST = 'massnahme_anlegen.massnahme_bei_schaden';
const SECOND = 'system_faellig.kontrolle_wird_faellig';

describe('buildRules', () => {
  it('lists every automatic action as timing, condition and task, in file order', () => {
    const rules = buildRules(doc(), 'en');
    expect(rules.map((r) => r.key)).toEqual([FIRST, SECOND]);
    const first = rules[0];
    expect(first?.trigger).toEqual({ kind: 'after', task: 'kontrolle' });
    expect(first?.taskLabel).toBe('Perform inspection');
    expect(first?.run).toBe('massnahme_anlegen');
    expect(first?.name).toBe('massnahme_bei_schaden');
    expect(first?.runLabel).toBe('Create measure');
  });

  it('shows a simple condition as chips (core toChips) and keeps the source', () => {
    const first = buildRules(doc(), 'en')[0];
    expect(first?.when?.source).toBe("self.vitalitaet >= 'v3'");
    expect(first?.when?.chips).toEqual({
      ok: true,
      chips: [{ kind: 'compare', left: 'self.vitalitaet', op: '>=', right: 'v3' }],
    });
  });

  it('falls back to text for a condition chips cannot show without changing its meaning', () => {
    const d = doc().apply({
      kind: 'set',
      path: `tasks.massnahme_anlegen.auto.massnahme_bei_schaden.when`,
      value: "self.vitalitaet >= 'v3' && (self.stage == 'a' || self.stage == 'b')",
    }).doc;
    const first = buildRules(d, 'en')[0];
    expect(first?.when?.chips.ok).toBe(false);
  });

  it('marks time timings as server-only', () => {
    const second = buildRules(doc(), 'en')[1];
    expect(second?.trigger).toEqual({ kind: 'elapsed', from: 'self.faellig_am' });
    expect(second?.serverOnly).toBe(true);
  });

  it('reads an entry without a timing as an edge, not a time timing (WP-438)', () => {
    const edited = doc().apply({
      kind: 'set',
      path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.when',
      value: 'self.vitalitaet >= 4',
    }).doc;
    const d = edited.apply({
      kind: 'hide',
      path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.after',
    }).doc;
    const first = buildRules(d, 'en')[0];
    expect(first?.trigger).toEqual({ kind: 'edge', condition: 'self.vitalitaet >= 4' });
    expect(first?.when).toBeUndefined();
    expect(first?.serverOnly).toBe(false);
    expect(buildRules(d, 'en')[1]?.serverOnly).toBe(true);
  });

  it('names a property-change timing by type and property', () => {
    const d = doc().apply({
      kind: 'set',
      path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.change',
      value: 'baum.stage',
    }).doc;
    // two timings would be a compile problem; here only the read is checked, so drop `after` first
    const cleared = d.apply({
      kind: 'hide',
      path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.after',
    }).doc;
    expect(buildRules(cleared, 'en')[0]?.trigger).toEqual({
      kind: 'change',
      type: 'baum',
      property: 'stage',
    });
  });

  it('tells where an automatic action comes from', () => {
    expect(buildRules(doc(), 'en')[0]?.provenance).toBe('template');
  });
});
