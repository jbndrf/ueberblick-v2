// WP-556: PlanApi.fireRule, the entry for timer-fired rules. Same code path as event-triggered rules (rules.ts fireOne).
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Key } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { FireResult, PlanOptions } from './contract';
import { addAuto } from './__fixtures__/auto';
import { inlineFile } from './__fixtures__/inline';
import { World, build, fid, rulePorts } from './__fixtures__/world';

const planApi = createPlan(formApi);
const DUE = '2026-10-01T06:00:00Z';
const POINT = { type: 'Point', coordinates: [1, 1] };

function setup() {
  const file = inlineFile(3) as Record<string, Record<string, unknown>>;
  const item = (file['types'] as Record<string, { properties: Record<string, unknown> }>)['item'];
  if (item === undefined) throw new Error('fixture has no item');
  item.properties['due'] = { type: 'date' };
  addAuto(file, 'noop', 'due_noop', {
    elapsed: { from: 'self.due', offset: '-days(14)' },
    when: 'self.n == 0',
  });
  // an automatic run has no form: its value is the task's `then.set`
  const tasks = file['tasks'] as Record<string, Record<string, unknown>>;
  tasks['set_kind'] = {
    ...tasks['set_kind'],
    then: [{ set: { kind: "form.kind != null ? form.kind : 'due: ' + self.label" } }],
  };
  addAuto(file, 'set_kind', 'due_log', { elapsed: { from: 'self.due' } });
  addAuto(file, 'noop', 'after_due', { after: 'set_kind' });
  tasks['nightly_note'] = {
    label: 'Nightly note',
    on: '$none',
    creates: 'log',
    form: { note: { required: true } },
    then: [{ set: { note: "'nightly'" } }],
  };
  addAuto(file, 'nightly_note', 'nightly', { schedule: '0 6 * * *' });
  const config = build(file);
  const w = new World(config);
  w.add(fid(1), 'item', { geom: POINT, label: 'a', n: 0 });
  w.add(fid(2), 'item', { geom: POINT, label: 'b', n: 4 });
  return { config, perms: compilePerms(config), p: rulePorts(w) };
}

const fire = (
  rule: string,
  subject: FeatureId | undefined,
  ruleDepth = 8,
  options?: PlanOptions,
): FireResult => {
  const { config, perms, p } = setup();
  return planApi.fireRuleFor(
    { rule: rule as Key, ...(subject !== undefined ? { subject } : {}), configVersion: 7, dueAt: DUE },
    oneVersion(config, perms),
    { ...p, limits: { ruleDepth } },
    options,
  );
};
const ok = (r: FireResult) => {
  if (!r.ok) throw new Error(`refused: ${r.refusal.code} ${r.refusal.message}`);
  return r.runs;
};

describe('PlanApi.fireRule', () => {
  it('plans the rule task as a system run on the subject', () => {
    const runs = ok(fire('noop.due_noop', fid(1)));
    expect(runs).toHaveLength(1);
    const head = runs[0];
    expect(head?.rule).toBe('noop.due_noop');
    expect(head?.run.task).toBe('noop');
    expect(head?.run.actor.kind).toBe('system');
    expect(head?.run.featureId).toBe(fid(1));
    expect(head?.run.configVersion).toBe(7);
    expect(head?.run.causedBy).toBeUndefined();
  });

  it('a false `when` fires nothing (empty runs, no refusal)', () => {
    expect(ok(fire('noop.due_noop', fid(2)))).toEqual([]);
  });

  it('the task `then.set` is evaluated against the subject and lands in the observations', () => {
    const runs = ok(fire('set_kind.due_log', fid(1)));
    const created = runs[0]?.observations.find((o) => o.property === 'kind');
    expect(created?.result).toBe('due: a');
    expect(runs[0]?.run.featureId).toBe(fid(1));
  });

  it('a schedule rule fires without a subject', () => {
    const runs = ok(fire('nightly_note.nightly', undefined));
    expect(runs[0]?.run.task).toBe('nightly_note');
    expect(runs[0]?.run.featureId).toBeUndefined();
  });

  it('refuses the rule chain deeper than the platform limit', () => {
    const r = fire('noop.due_noop', fid(1), 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('depth_exceeded');
  });

  it('refuses a key that is no time-based rule (unknown, or event-triggered)', () => {
    for (const key of ['nope', 'bump.again']) {
      const r = fire(key, fid(1));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusal.code).toBe('not_available');
    }
  });

  it('has no trace unless asked for', () => {
    const r = fire('set_kind.due_log', fid(1));
    expect(r.trace).toBeUndefined();
  });

  it('the trace root carries a timer trigger with the dueAt it was given, and a cascade traces below it', () => {
    const r = fire('set_kind.due_log', fid(1), 8, { trace: true });
    const trace = r.trace ?? [];
    const root = trace.find((e) => e.rule === 'set_kind.due_log');
    expect(root?.reason).toBe('fired');
    expect(root?.depth).toBe(0);
    expect(root?.subject).toBe(fid(1));
    expect(root?.trigger).toEqual({ kind: 'timer', dueAt: DUE });
    if (!r.ok) throw new Error('refused');
    // the cascade: the event rule fired by the timer's system run, one level down, caused by that run
    const child = trace.find((e) => e.rule === 'noop.after_due');
    expect(child?.reason).toBe('fired');
    expect(child?.depth).toBe(1);
    expect(child?.trigger).toEqual({ kind: 'run', causedBy: r.runs[0]?.run.id });
    expect(trace.findIndex((e) => e.rule === 'noop.after_due')).toBeGreaterThan(
      trace.findIndex((e) => e.rule === 'set_kind.due_log'),
    );
  });

  it('a false `when` is traced as when_false with the timer trigger', () => {
    const e = fire('noop.due_noop', fid(2), 8, { trace: true }).trace ?? [];
    expect(e).toHaveLength(1);
    expect(e[0]?.reason).toBe('when_false');
    expect(e[0]?.trigger).toEqual({ kind: 'timer', dueAt: DUE });
  });

  it('a refused chain returns the trace up to the refusal', () => {
    const r = fire('noop.due_noop', fid(1), 0, { trace: true });
    expect(r.ok).toBe(false);
    expect(r.trace?.[0]?.reason).toBe('depth_exceeded');
    expect(r.trace?.[0]?.trigger.kind).toBe('timer');
  });
});
