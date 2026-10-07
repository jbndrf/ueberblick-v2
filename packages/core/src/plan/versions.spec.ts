// WP-314 (A-029 §2, L1): plan resolves each feature's config through `configFor`.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Key, Run } from '../model';
import { compilePerms } from '../perms';
import type { CompiledConfig } from '../schema/compile/contract';
import { NEW_FEATURE, oneVersion, type ConfigFor } from './contract';
import { createPlan } from './index';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const anna = actor('participant', 'anna', ['worker']);

const base = (v: 1 | 2) => ({
  schema: 'ueberblick/1',
  template: { key: 'ver', version: `${v}.0.0` },
  roles: { worker: { label: 'Worker' } },
  types: {
    akte: {
      label: 'Akte',
      // v2 no longer lets workers write `status`.
      permissions: { see: '$all', create: '$all', write: v === 1 ? '$all' : { due: ['worker'] } },
      properties: {
        status: { type: 'text' },
        due: { type: v === 1 ? 'date' : 'text' },
      },
    },
    fall: {
      label: 'Fall',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        note: { type: 'text' },
        akte: { type: 'reference', to: 'akte' },
        ...(v === 2 ? { extra: { type: 'text' } } : {}),
      },
    },
  },
  tasks: {
    add: { label: 'Add', on: '$none', creates: 'fall', form: { note: {} } },
    edit: { label: 'Edit', on: 'fall', form: v === 2 ? { note: {}, extra: {} } : { note: {} } },
    mark: {
      label: 'Mark',
      on: 'fall',
      bind: { a: 'self.akte' },
      then: [{ set: { 'a.status': "'marked'" } }],
    },
    stamp: {
      label: 'Stamp',
      on: 'fall',
      bind: { a: 'self.akte' },
      then: [{ set: { 'a.due': v === 1 ? 'today() + months(1)' : "'later'" } }],
      auto: { on_edit: { after: 'edit', when: 'self.akte != null' } },
    },
    ...(v === 2 ? { only2: { label: 'Only 2', on: 'fall' } } : {}),
  },
});

const c1 = build(base(1));
const c2 = build(base(2));
const p1 = compilePerms(c1);
const p2 = compilePerms(c2);
const configs: Record<number, { config: CompiledConfig; perms: ReturnType<typeof compilePerms> }> = {
  1: { config: c1, perms: p1 },
  2: { config: c2, perms: p2 },
};

let n = 0;
function setup() {
  const w = new World(c2);
  const p = ports(w);
  const calls: string[] = [];
  const configFor: ConfigFor = (key) => {
    calls.push(key);
    const version = key === NEW_FEATURE ? 2 : (w.feature(key)?.pinnedVersion ?? 2);
    return { ...(configs[version] as (typeof configs)[1]), version };
  };
  const seed = (id: FeatureId, type: string, props: Record<string, string>, pin?: number): FeatureId => {
    w.add(id, type, props);
    if (pin !== undefined)
      w.append(rid(++n), [{ featureId: id, property: '$version', result: pin }], 'system');
    return id;
  };
  const run = (task: string, feature?: FeatureId, input: Record<string, string> = {}, v = 2): Run => ({
    id: rid(++n),
    task: task as Key,
    actor: anna,
    configVersion: v,
    input,
    clientTime: new Date(Date.UTC(2026, 4, 1, 8, 0, n % 60)).toISOString(),
    ...(feature === undefined ? {} : { featureId: feature }),
  });
  return { w, p, calls, configFor, seed, run };
}

describe('plan under the feature version (A-029 §2)', () => {
  it('a v1-pinned feature is offered v1 tasks only; a floating one gets the deployed version', () => {
    const s = setup();
    const old = s.seed(fid(1), 'fall', { note: 'a' }, 1);
    const fresh = s.seed(fid(2), 'fall', { note: 'b' });
    expect(api.availableTasksFor(old, anna, s.configFor, s.p)).not.toContain('only2');
    expect(api.availableTasksFor(fresh, anna, s.configFor, s.p)).toContain('only2');
    const a = api.availableFor('only2' as Key, { feature: old }, anna, s.configFor, s.p);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.refusal.code).toBe('unknown_task');
  });

  it('a v2-only field is refused on a v1-pinned feature, accepted on a floating one', () => {
    const s = setup();
    const old = s.seed(fid(1), 'fall', { note: 'a' }, 1);
    const fresh = s.seed(fid(2), 'fall', { note: 'b' });
    const refused = api.planFor([s.run('edit', old, { extra: 'x' })], s.configFor, s.p);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal.code).toBe('invalid_input');
    expect(api.planFor([s.run('edit', fresh, { extra: 'x' })], s.configFor, s.p).ok).toBe(true);
  });

  it('a create floats: it resolves NEW_FEATURE and writes no pin', () => {
    const s = setup();
    const r = api.planFor([s.run('add', undefined, { note: 'x' })], s.configFor, s.p);
    if (!r.ok) throw new Error(r.refusal.message);
    expect(s.calls).toContain(NEW_FEATURE);
    expect(s.calls.filter((c) => c !== NEW_FEATURE)).toEqual([]);
    expect(r.runs.flatMap((x) => x.observations).some((o) => o.property === '$version')).toBe(false);
  });

  it('a write to another feature is validated under the target version (permissions)', () => {
    const s = setup();
    const akteNew = s.seed(fid(10), 'akte', { status: 'open' });
    const akteOld = s.seed(fid(11), 'akte', { status: 'open' }, 1);
    // The v1 feature itself (task `mark` exists in v1 and v2) writes to its akte.
    const f1 = s.seed(fid(1), 'fall', { akte: akteNew }, 1);
    const f2 = s.seed(fid(2), 'fall', { akte: akteOld }, 1);
    const toV2 = api.planFor([s.run('mark', f1, {}, 1)], s.configFor, s.p);
    expect(toV2.ok).toBe(false);
    if (!toV2.ok) expect(toV2.refusal.code).toBe('not_permitted');
    expect(api.planFor([s.run('mark', f2, {}, 1)], s.configFor, s.p).ok).toBe(true);
  });

  it('a rule on a v1 feature writing to a v2 feature is validated against v2 (property type)', () => {
    const s = setup();
    const akteNew = s.seed(fid(10), 'akte', {});
    const akteOld = s.seed(fid(11), 'akte', {}, 1);
    const f1 = s.seed(fid(1), 'fall', { akte: akteNew }, 1);
    const f2 = s.seed(fid(2), 'fall', { akte: akteOld }, 1);
    const due = (id: FeatureId, akte: FeatureId): string | undefined => {
      const r = api.planFor([s.run('edit', id, { note: 'x' }, 1)], s.configFor, s.p);
      if (!r.ok) throw new Error(r.refusal.message);
      const stamp = r.runs.find((x) => x.rule !== undefined);
      expect(stamp?.run.configVersion).toBe(1);
      return stamp?.observations.find((o) => o.featureId === akte && o.property === 'due')?.result as
        string | undefined;
    };
    expect(due(f1, akteNew)).toMatch(/^\d{4}-\d{2}-\d{2}T/); // v2: `text` keeps the timestamp
    expect(due(f2, akteOld)).toMatch(/^\d{4}-\d{2}-\d{2}$/); // v1: `date`
  });

  it('L1: a run with configVersion 2 on a v1-pinned feature is planned under v1 and stamped 1', () => {
    const s = setup();
    const old = s.seed(fid(1), 'fall', { note: 'a' }, 1);
    const fresh = s.seed(fid(2), 'fall', { note: 'b' });
    const r = api.planFor([s.run('edit', old, { note: 'n' }, 2)], s.configFor, s.p);
    if (!r.ok) throw new Error(r.refusal.message);
    expect(r.runs[0]?.run.configVersion).toBe(1);
    // under v1 the v2 task `only2` does not exist: the replan refuses (goes to review on the server)
    const gone = api.planFor([s.run('only2', old, {}, 2)], s.configFor, s.p);
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.refusal.code).toBe('unknown_task');
    // a floating feature keeps version 2
    const f = api.planFor([s.run('edit', fresh, { note: 'n' }, 2)], s.configFor, s.p);
    if (!f.ok) throw new Error('refused');
    expect(f.runs[0]?.run.configVersion).toBe(2);
  });

  it('the resolver is called once per touched feature per plan call', () => {
    const s = setup();
    const akte = s.seed(fid(10), 'akte', {}, 1);
    const f = s.seed(fid(1), 'fall', { akte }, 1);
    s.calls.length = 0;
    const r = api.planFor([s.run('mark', f, {}, 1), s.run('mark', f, {}, 1)], s.configFor, s.p);
    expect(r.ok).toBe(true);
    for (const key of new Set(s.calls)) expect(s.calls.filter((c) => c === key)).toHaveLength(1);
  });
});

describe('one version: the adapter changes nothing', () => {
  it('property: with one version, plan equals planFor with an explicit version resolver', () => {
    const tasks = ['add', 'edit', 'mark', 'only2', 'stamp'];
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...tasks), fc.boolean(), fc.string({ maxLength: 4 })), {
          minLength: 1,
          maxLength: 4,
        }),
        (steps) => {
          const s1 = setup();
          const s2 = setup();
          const s3 = setup();
          for (const s of [s1, s2, s3]) s.seed(fid(1), 'fall', { note: 'a' });
          const mk = (s: ReturnType<typeof setup>): Run[] =>
            steps.map(([t, onFeature, note]) => s.run(t, onFeature ? fid(1) : undefined, { note }, 2));
          // Same run ids on both sides.
          n = 0;
          const b1 = mk(s1);
          n = 0;
          const b2 = mk(s2);
          n = 0;
          const b3 = mk(s3);
          const legacy = api.planFor(b1, oneVersion(c2, p2), s1.p);
          const explicit = api.planFor(b2, () => ({ config: c2, perms: p2, version: 2 }), s2.p);
          expect(explicit).toEqual(legacy);
          expect(api.planFor(b3, oneVersion(c2, p2), s3.p)).toEqual(legacy);
        },
      ),
      { numRuns: 40 },
    );
  });
});
