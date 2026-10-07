// WP-389 / A-038: a participant run fires a rule that sets the stage; the rule run inherits the participant run's time,
// so `changed_at('stage')` returns it. Also: the timer re-schedules on a stage write however `changed_at` is written.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { elapsedDueAt, timeRules } from '../rules/timing';
import { createPlan, oneVersion } from './index';
import { World, actor, build, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'cr', version: '1.0.0' },
  roles: { worker: { label: 'Worker' } },
  types: {
    fall: {
      label: 'Fall',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { note: { type: 'text' }, stage: { type: 'text' } },
    },
  },
  tasks: {
    add: { label: 'Add', on: '$none', creates: 'fall', form: { note: {} } },
    melden: { label: 'Melden', on: 'fall', form: { note: {} } },
    weiter: {
      label: 'Weiter',
      on: 'fall',
      then: [{ set: { stage: "'bearbeitung'" } }],
      auto: {
        nach_melden: { after: 'melden' },
        seit_phase: { elapsed: { from: "changed_at('stage')", after: 'days(3)' } },
        seit_phase_doppelt: {
          elapsed: { from: 'self.$created_at', after: 'days(1) + (changed_at("stage") - self.$created_at)' },
        },
      },
    },
  },
};
const anna = actor('participant', 'anna', ['worker']);
const T1 = '2026-05-02T09:30:00.000Z';

describe('changed_at after a rule run', () => {
  const config = build(file);
  const world = new World(config);
  const perms = compilePerms(config);
  const p = ports(world);
  let n = 0;
  const go = (task: string, feature?: FeatureId, input: Record<string, string> = {}, clientTime?: string) => {
    const run: Run = {
      id: rid(++n),
      task: task as Key,
      actor: anna,
      configVersion: 1,
      input,
      ...(clientTime === undefined ? {} : { clientTime }),
      ...(feature === undefined ? {} : { featureId: feature }),
    };
    const res = api.planFor([run], oneVersion(config, perms), p);
    if (!res.ok) throw new Error(res.refusal.message);
    for (const pr of res.runs) world.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };

  it("returns the participant run's time for a stage the rule wrote", () => {
    const created = go('add', undefined, { note: 'x' }, '2026-05-01T08:00:00.000Z');
    const id = created.runs[0]?.created[0] as FeatureId;
    const res = go('melden', id, { note: 'y' }, T1);
    expect(res.runs.length).toBeGreaterThan(1); // the participant run and the rule run
    expect(world.feature(id)?.properties['stage']).toBe('bearbeitung');
    const newest = world.history(id, 'stage', 1)[0];
    expect(newest?.phenomenonTime).toBe(T1);
    const rule = timeRules(config).elapsed.get('weiter.seit_phase');
    if (rule === undefined) throw new Error('rule missing');
    const ctx = {
      vars: new Map([['self', { $feature: id }]]),
      features: {
        property: () => undefined,
        related: () => [],
        history: (f: FeatureId, prop: string, limit: number) => world.history(f, prop, limit),
        type: () => 'fall' as Key,
      },
      now: T1,
      relations: new Map(),
      geo: p.geo,
    };
    expect(elapsedDueAt(rule, ctx)).toBe('2026-05-05T09:30:00.000Z');
  });

  it('reads: single- and double-quoted changed_at, also nested in another call, name the property', () => {
    const rules = timeRules(config).elapsed;
    expect([...(rules.get('weiter.seit_phase')?.reads ?? [])]).toEqual(['stage']);
    expect(rules.get('weiter.seit_phase_doppelt')?.reads).toContain('stage');
  });
});
