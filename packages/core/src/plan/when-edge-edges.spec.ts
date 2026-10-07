// WP-430 / A-045: the "before" view of a `{ when }` rule also undoes the run's edge changes, so a condition over
// relations fires exactly on false → true.
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
    eltern: {
      label: 'Eltern',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { hits: { type: 'number', default: 0 }, phase: { type: 'text' } },
      relations: { kinder: { to: 'kind', inverse_of: 'kind.eltern', cardinality: 'many' } },
    },
    kind: {
      label: 'Kind',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { eltern: { type: 'reference', to: 'eltern' } },
    },
  },
  tasks: {
    neu: { label: 'Neu', on: '$none', creates: 'kind', form: { eltern: {} } },
    haenge: { label: 'Hänge', on: 'kind', form: { eltern: {} } },
    loese: { label: 'Löse', on: 'kind', then: [{ set: { eltern: null } }] },
    phase: { label: 'Phase', on: 'eltern', form: { phase: {} } },
    zaehle: {
      label: 'Zähle',
      on: 'eltern',
      then: [{ set: { hits: 'self.hits + 1' } }],
      auto: {
        hat_kinder: { when: 'self.kinder.size() > 0' },
        ist_x: { when: "self.kinder.exists(k, k.eltern.phase == 'x')" },
      },
    },
  },
};
const P = fid(1);

function setup() {
  const config = build(file);
  const world = new World(config);
  const perms = compilePerms(config);
  const p = ports(world);
  let n = 0;
  const go = (task: string, feature: FeatureId | undefined, input: Record<string, unknown>): PlanResult => {
    const run = {
      id: rid(++n),
      task: task as Key,
      actor: anna,
      configVersion: 1,
      input,
      ...(feature === undefined ? {} : { featureId: feature }),
    } as Run;
    const res = api.planFor([run], oneVersion(config, perms), p, { trace: true });
    if (res.ok) for (const pr of res.runs) world.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };
  world.add(P, 'eltern', { hits: 0 });
  return { world, go };
}
const fired = (res: PlanResult, rule: string): number =>
  res.ok ? res.runs.filter((r) => r.rule === rule).length : -1;
const hits = (w: World): unknown => w.feature(P)?.properties['hits'];

describe('{ when } over relations', () => {
  it('the first child fires once, the second does not, removing all and adding again fires again', () => {
    const { world, go } = setup();
    const a = go('neu', undefined, { eltern: P });
    expect(fired(a, 'zaehle.hat_kinder')).toBe(1);
    const k1 = a.ok ? a.runs[0]?.created[0] : undefined;
    expect(hits(world)).toBe(1);
    const b = go('neu', undefined, { eltern: P });
    expect(fired(b, 'zaehle.hat_kinder')).toBe(0);
    expect(b.trace?.find((e) => e.rule === 'zaehle.hat_kinder')?.reason).toBe('already_true');
    const k2 = b.ok ? b.runs[0]?.created[0] : undefined;
    expect(fired(go('loese', k1, {}), 'zaehle.hat_kinder')).toBe(0);
    expect(fired(go('loese', k2, {}), 'zaehle.hat_kinder')).toBe(0);
    expect(fired(go('neu', undefined, { eltern: P }), 'zaehle.hat_kinder')).toBe(1);
    expect(hits(world)).toBe(2);
  });

  it('re-hanging an existing child onto the parent fires (an edge added to a feature the run did not write)', () => {
    const { world, go } = setup();
    world.add(fid(2), 'kind', {});
    expect(fired(go('haenge', fid(2), { eltern: P }), 'zaehle.hat_kinder')).toBe(1);
    expect(hits(world)).toBe(1);
  });

  it('a condition through an edge and a property of the other end sees both undone', () => {
    const { world, go } = setup();
    world.add(fid(2), 'kind', { eltern: P });
    expect(fired(go('phase', P, { phase: 'y' }), 'zaehle.ist_x')).toBe(0);
    expect(fired(go('phase', P, { phase: 'x' }), 'zaehle.ist_x')).toBe(1);
    expect(fired(go('phase', P, { phase: 'x' }), 'zaehle.ist_x')).toBe(0);
  });

  it('property: fires == false → true transitions of "has a child", under random hang / release', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 2, max: 4 }), fc.boolean()), { maxLength: 25 }),
        (steps) => {
          const { world, go } = setup();
          for (const id of [2, 3, 4]) world.add(fid(id), 'kind', {});
          const mine = new Set<number>();
          let expected = 0;
          for (const [id, hang] of steps) {
            const had = mine.size > 0;
            if (hang) mine.add(id);
            else mine.delete(id);
            const res = hang ? go('haenge', fid(id), { eltern: P }) : go('loese', fid(id), {});
            if (!res.ok) return false;
            if (!had && mine.size > 0) expected++;
          }
          return hits(world) === expected;
        },
      ),
      { numRuns: 60 },
    );
  });
});
