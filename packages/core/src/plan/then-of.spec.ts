// WP-374 (A-035): `of` on the `lifecycle` and `set` then-steps acts on other features (relation couplings, owner A2).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formApi } from '../form';
import type { FeatureId, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { THEN_STEP_TARGETS_MAX } from '../registry';
import { createPlan, oneVersion } from './index';
import type { PlanResult, PlannedRun } from './contract';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'of', version: '1.0.0' },
  roles: { boss: { label: 'Boss' }, worker: { label: 'Worker' } },
  types: {
    eltern: {
      label: 'Eltern',
      permissions: { see: '$all', create: '$all', write: '$all', delete: ['boss', 'worker'] },
      properties: { name: { type: 'text' } },
      relations: { kinder: { to: 'kind', inverse_of: 'kind.eltern', cardinality: 'many' } },
    },
    kind: {
      label: 'Kind',
      permissions: { see: '$all', create: '$all', write: '$all', delete: ['boss'] },
      properties: { name: { type: 'text' }, eltern: { type: 'reference', to: 'eltern' } },
    },
    meldung: {
      label: 'Meldung',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { text: { type: 'text' } },
    },
  },
  tasks: {
    loeschen: {
      label: 'Löschen',
      on: 'eltern',
      then: [{ lifecycle: 'deleted', of: 'self.kinder' }, { lifecycle: 'deleted' }],
    },
    trennen: { label: 'Trennen', on: 'eltern', then: [{ set: { eltern: null }, of: 'self.kinder' }] },
    benennen: {
      label: 'Benennen',
      on: 'eltern',
      form: { name: {} },
      then: [{ set: { name: 'form.name' }, of: 'self.kinder' }],
    },
    abschliessen_of: { label: 'a', on: 'eltern', then: [{ lifecycle: 'completed', of: 'self' }] },
    abschliessen: { label: 'b', on: 'eltern', then: [{ lifecycle: 'completed' }] },
    melden: {
      label: 'Melden',
      on: '$none',
      creates: 'meldung',
      auto: { gemeldet: { after: 'trennen' } },
    },
  },
};
const boss = actor('participant', 'b', ['boss']);
const worker = actor('participant', 'w', ['worker']);
const P = fid(1);
const kid = (i: number): FeatureId => fid(100 + i);

let n = 0;
function setup(children: number) {
  const config = build(file);
  const w = new World(config);
  w.add(P, 'eltern', { name: 'p' });
  for (let i = 0; i < children; i++) w.add(kid(i), 'kind', { name: `k${i}`, eltern: P });
  const perms = compilePerms(config);
  const p = ports(w);
  const go = (task: string, by = boss, input: Record<string, string> = {}, apply = true): PlanResult => {
    const r: Run = { id: rid(++n), task: task as Key, actor: by, configVersion: 1, input, featureId: P };
    const res = api.planFor([r], oneVersion(config, perms), p);
    if (apply && res.ok) for (const pr of res.runs) w.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };
  return { w, go };
}
const first = (r: PlanResult): PlannedRun => {
  if (!r.ok) throw new Error(`refused: ${r.refusal.code} ${r.refusal.message}`);
  return r.runs[0] as PlannedRun;
};

describe('lifecycle with of (mitlöschen)', () => {
  it('a parent with 3 children: one run, 4 lifecycle observations, every child deleted', () => {
    const s = setup(3);
    const r = s.go('loeschen');
    const run = first(r);
    expect(run.observations.filter((o) => o.property === '$lifecycle')).toHaveLength(4);
    expect(run.observations.map((o) => o.featureId)).toEqual([kid(0), kid(1), kid(2), P]);
    for (let i = 0; i < 3; i++) expect(s.w.feature(kid(i))?.lifecycle).toBe('deleted');
    expect(s.w.feature(P)?.lifecycle).toBe('deleted');
  });
  it('a child the actor may not delete refuses the whole run, naming the child', () => {
    const s = setup(3);
    const r = s.go('loeschen', worker, {}, false);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe('not_permitted');
      expect(r.refusal.path).toBe('types.kind.permissions.delete');
      expect(r.refusal.message).toContain(kid(0));
    }
    expect(s.w.feature(P)?.lifecycle).toBe('active');
  });
  it('rules fired by the parent run still fire once per subject', () => {
    const s = setup(3);
    const r = s.go('trennen');
    if (!r.ok) throw new Error('refused');
    expect(r.runs.filter((x) => x.run.task === 'melden')).toHaveLength(1);
  });
});

describe('set with of (trennen)', () => {
  it('clears the relation on each child', () => {
    const s = setup(3);
    const run = first(s.go('trennen'));
    expect(run.observations).toEqual(
      [0, 1, 2].map((i) => ({ featureId: kid(i), property: 'eltern', result: null })),
    );
    for (let i = 0; i < 3; i++) expect(s.w.feature(kid(i))?.properties['eltern']).toBeNull();
  });
  it('writes an expression value to each child', () => {
    const s = setup(2);
    first(s.go('benennen', boss, { name: 'neu' }));
    expect(s.w.feature(kid(1))?.properties['name']).toBe('neu');
  });
  it('a parent without children writes nothing', () => {
    const s = setup(0);
    expect(first(s.go('trennen')).observations).toEqual([]);
  });
});

describe('the target cap', () => {
  it('above THEN_STEP_TARGETS_MAX the run is refused with too_many_targets', () => {
    const s = setup(THEN_STEP_TARGETS_MAX + 1);
    const r = s.go('trennen', boss, {}, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('too_many_targets');
  });
  it('exactly at the cap passes', () => {
    const s = setup(THEN_STEP_TARGETS_MAX);
    expect(s.go('trennen', boss, {}, false).ok).toBe(true);
  });
});

describe('without of, nothing changes', () => {
  it('of: self equals no of (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom('boss', 'worker'), fc.integer({ min: 0, max: 3 }), (role, kids) => {
        const by = role === 'boss' ? boss : worker;
        const a = setup(kids).go('abschliessen_of', by, {}, false);
        const b = setup(kids).go('abschliessen', by, {}, false);
        const strip = (r: PlanResult) =>
          r.ok ? r.runs.map((x) => x.observations) : { code: r.refusal.code, path: r.refusal.path };
        expect(strip(a)).toEqual(strip(b));
      }),
      { numRuns: 12 },
    );
  });
});
