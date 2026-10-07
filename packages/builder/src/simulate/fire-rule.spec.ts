// WP-208.3: `Simulation.fireRule` plans a time-based rule that came due through core (`PlanApi.fireRule`).
import { describe, expect, it } from 'vitest';
import type { AutoId, FeatureId, Key } from '@ueberblick/core';
import { goldenDoc } from '../lenses/process/fixtures';
import { openSimulation } from './session';

const open = () => {
  const r = openSimulation(goldenDoc('baumkataster', '2.0.0').effective());
  if (!r.ok) throw new Error('does not compile');
  const sim = r.simulation;
  const tree = sim.generate('baum' as Key, { kontrolle_faellig: false, stage: 'geprueft' });
  return { sim, tree };
};
const DUE = '2026-05-02T06:00:00.000Z';
const rule = 'system_faellig.kontrolle_wird_faellig' as AutoId;

describe('Simulation.fireRule', () => {
  it('runs the rule task as a system run whose root names its due time, and returns the trace', () => {
    const { sim, tree } = open();
    const r = sim.fireRule({ rule, subject: tree, dueAt: DUE });
    if (!r.ok) throw new Error('refused');
    expect(r.runs.map((x) => [x.task, x.actorKind, x.rule, x.dueAt, x.causedBy])).toEqual([
      ['system_faellig', 'system', rule, DUE, undefined],
    ]);
    expect(r.trace[0]).toMatchObject({ rule, reason: 'fired', trigger: { kind: 'timer', dueAt: DUE } });
    expect(sim.feature(tree)?.properties['kontrolle_faellig']).toBe(true);
  });

  it('a dry run (commit: false) leaves the sandbox as it was', () => {
    const { sim, tree } = open();
    const r = sim.fireRule({ rule, subject: tree, dueAt: DUE }, { commit: false });
    expect(r.ok && r.runs).toHaveLength(1);
    expect(sim.feature(tree)?.properties['kontrolle_faellig']).toBe(false);
  });

  it('a false `when` fires nothing and the trace says why', () => {
    const { sim } = open();
    const done = sim.generate('baum' as Key, { stage: 'erledigt' });
    const r = sim.fireRule({ rule, subject: done, dueAt: DUE });
    if (!r.ok) throw new Error('refused');
    expect(r.runs).toEqual([]);
    expect(r.trace[0]?.reason).toBe('when_false');
    expect(r.trace[0]?.explanation?.text).toMatch(/erledigt/);
  });

  it('a rule that is not time-based is refused', () => {
    const { sim, tree } = open();
    const r = sim.fireRule({
      rule: 'massnahme_anlegen.massnahme_bei_schaden' as AutoId,
      subject: tree as FeatureId,
      dueAt: DUE,
    });
    expect(r.ok).toBe(false);
  });
});
