// WP-427 / A-045: the `{ when }` rule trigger fires once on false → true of a feature and re-arms when it turns false.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const anna = actor('participant', 'anna', ['worker']);

const file = {
  schema: 'ueberblick/1',
  template: { key: 'we', version: '1.0.0' },
  roles: { worker: { label: 'Worker' } },
  types: {
    fall: {
      label: 'Fall',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        n: { type: 'number', default: 0 },
        m: { type: 'number', default: 0 },
        hits: { type: 'number', default: 0 },
      },
    },
    anderes: {
      label: 'Anderes',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { n: { type: 'number', default: 0 } },
    },
  },
  tasks: {
    setze_a: { label: 'Setze a', on: 'anderes', form: { n: {} } },
    add: { label: 'Add', on: '$none', creates: 'fall', form: { n: {} } },
    setze: { label: 'Setze', on: 'fall', form: { n: {} } },
    zaehle: {
      label: 'Zähle',
      on: 'fall',
      then: [{ set: { hits: 'self.hits + 1' } }],
      auto: { ueber: { when: 'self.n > 10' }, kette_b: { when: 'self.m > 10' } },
    },
    setze_m: {
      label: 'Setze m',
      on: 'fall',
      then: [{ set: { m: '20' } }],
      auto: { kette_a: { when: 'self.n > 100' } },
    },
  },
};

function setup(limit?: number) {
  const config = build(file);
  const world = new World(config);
  const perms = compilePerms(config);
  const base = ports(world);
  const p = limit === undefined ? base : { ...base, limits: { ruleDepth: limit } };
  let n = 0;
  const go = (task: string, feature?: FeatureId, input: Record<string, number> = {}): PlanResult => {
    const run: Run = {
      id: rid(++n),
      task: task as Key,
      actor: anna,
      configVersion: 1,
      input,
      ...(feature === undefined ? {} : { featureId: feature }),
    };
    const res = api.planFor([run], oneVersion(config, perms), p, { trace: true });
    if (res.ok) for (const pr of res.runs) world.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };
  return { world, go };
}
const fired = (res: PlanResult, rule: string): number =>
  res.ok ? res.runs.filter((r) => r.rule === rule).length : -1;

describe('{ when } trigger', () => {
  it('fires once when the condition turns true, not again while it stays true, and re-arms (golden scenario)', () => {
    const { world, go } = setup();
    world.add(fid(1), 'fall', { n: 0, m: 0, hits: 0 });
    expect(fired(go('setze', fid(1), { n: 5 }), 'zaehle.ueber')).toBe(0);
    expect(fired(go('setze', fid(1), { n: 11 }), 'zaehle.ueber')).toBe(1);
    expect(world.feature(fid(1))?.properties['hits']).toBe(1);
    const again = go('setze', fid(1), { n: 12 });
    expect(fired(again, 'zaehle.ueber')).toBe(0);
    expect(again.trace?.find((e) => e.rule === 'zaehle.ueber')?.reason).toBe('already_true');
    expect(fired(go('setze', fid(1), { n: 3 }), 'zaehle.ueber')).toBe(0);
    expect(fired(go('setze', fid(1), { n: 20 }), 'zaehle.ueber')).toBe(1);
    expect(world.feature(fid(1))?.properties['hits']).toBe(2);
  });

  it('a feature created with the condition already true fires (it did not exist before)', () => {
    const { world, go } = setup();
    const res = go('add', undefined, { n: 50 });
    expect(fired(res, 'zaehle.ueber')).toBe(1);
    const made = res.ok ? res.runs.flatMap((r) => r.created)[0] : undefined;
    expect(world.feature(made as FeatureId)?.properties['hits']).toBe(1);
  });

  it('a run that does not touch the feature does not fire, and the trace says so', () => {
    const { world, go } = setup();
    world.add(fid(1), 'fall', { n: 50, m: 0, hits: 0 });
    world.add(fid(2), 'fall', { n: 0, m: 0, hits: 0 });
    const res = go('zaehle', fid(2));
    expect(fired(res, 'zaehle.ueber')).toBe(0);
    expect(res.trace?.find((e) => e.rule === 'zaehle.ueber')?.reason).toBe('trigger_not_matched');
  });

  it('a feature of another type than the rule task is offered on is skipped, not judged', () => {
    const { world, go } = setup();
    world.add(fid(7), 'anderes', { n: 0 });
    const res = go('setze_a', fid(7), { n: 50 });
    expect(res.ok).toBe(true);
    expect(fired(res, 'zaehle.ueber')).toBe(0);
    expect(res.trace?.find((e) => e.rule === 'zaehle.ueber')?.reason).toBe('trigger_not_matched');
  });

  it('cascade: a rule fired by a `when` trigger that makes another `when` true respects the depth bound', () => {
    const deep = setup(3);
    deep.world.add(fid(1), 'fall', {});
    const ok = deep.go('setze', fid(1), { n: 101 });
    expect(fired(ok, 'setze_m.kette_a')).toBe(1);
    expect(fired(ok, 'zaehle.kette_b')).toBe(1);

    const shallow = setup(1);
    shallow.world.add(fid(1), 'fall', {});
    const refused = shallow.go('setze', fid(1), { n: 101 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal.code).toBe('depth_exceeded');
  });

  it('property: fires == the number of false → true transitions, per feature', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 0, max: 20 })), {
          maxLength: 25,
        }),
        (steps) => {
          const { world, go } = setup();
          for (const id of [1, 2, 3]) world.add(fid(id), 'fall', { n: 0, m: 0, hits: 0 });
          const was = new Map<number, boolean>();
          const expected = new Map<number, number>();
          for (const [id, n] of steps) {
            const res = go('setze', fid(id), { n });
            const now = n > 10;
            if (now && was.get(id) !== true) expected.set(id, (expected.get(id) ?? 0) + 1);
            was.set(id, now);
            if (!res.ok) return false;
          }
          return [1, 2, 3].every(
            (id) => world.feature(fid(id))?.properties['hits'] === (expected.get(id) ?? 0),
          );
        },
      ),
      { numRuns: 60 },
    );
  });
});
