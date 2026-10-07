// WP-305: the `lifecycle` then step, its permission, and `case_closed` on archived or deleted features.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult, PlannedRun } from './contract';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'lc', version: '1.0.0' },
  roles: { boss: { label: 'Boss' }, worker: { label: 'Worker' } },
  types: {
    fall: {
      label: 'Fall',
      permissions: { see: '$all', create: '$all', write: '$all', delete: ['boss'] },
      properties: { note: { type: 'text' } },
    },
  },
  tasks: {
    add: { label: 'Add', on: '$none', creates: 'fall', form: { note: {} } },
    note: { label: 'Note', on: 'fall', form: { note: {} } },
    complete: { label: 'Complete', on: 'fall', then: [{ lifecycle: 'completed' }] },
    reopen: { label: 'Reopen', on: 'fall', then: [{ lifecycle: 'active' }] },
    archive: { label: 'Archive', on: 'fall', then: [{ lifecycle: 'archived' }] },
    remove: { label: 'Remove', on: 'fall', then: [{ lifecycle: 'deleted' }] },
    maybe: {
      label: 'Maybe',
      on: 'fall',
      form: { note: {} },
      then: [{ lifecycle: 'completed', when: "form.note == 'done'" }],
    },
  },
};
const boss = actor('participant', 'b', ['boss']);
const worker = actor('participant', 'w', ['worker']);
const admin = actor('admin', 'root');
const F: FeatureId = fid(7);

let n = 0;
function setup() {
  const config = build(file);
  const w = new World(config);
  w.add(F, 'fall', { note: 'x' });
  const perms = compilePerms(config);
  const p = ports(w);
  const go = (task: string, by = admin, input: Record<string, never | string> = {}): PlanResult => {
    const r: Run = { id: rid(++n), task: task as Key, actor: by, configVersion: 1, input, featureId: F };
    const res = api.planFor([r], oneVersion(config, perms), p);
    if (res.ok) for (const pr of res.runs) w.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };
  return { w, go };
}
const code = (r: PlanResult): string => (r.ok ? 'ok' : r.refusal.code);

describe('lifecycle step', () => {
  it('writes the observation $lifecycle on the subject', () => {
    const s = setup();
    const r = s.go('complete');
    expect(r.ok && (r.runs[0] as PlannedRun).observations).toEqual([
      { featureId: F, property: '$lifecycle', result: 'completed' },
    ]);
    expect(s.w.feature(F)?.lifecycle).toBe('completed');
  });
  it('a conditional step honours when', () => {
    const s = setup();
    s.go('maybe', admin, { note: 'no' });
    expect(s.w.feature(F)?.lifecycle).toBe('active');
    s.go('maybe', admin, { note: 'done' });
    expect(s.w.feature(F)?.lifecycle).toBe('completed');
  });
  it('complete, reopen, archive: a completed feature accepts runs, an archived one does not', () => {
    const s = setup();
    expect(code(s.go('complete'))).toBe('ok');
    expect(code(s.go('note', admin, { note: 'still ok' }))).toBe('ok');
    expect(code(s.go('reopen'))).toBe('ok');
    expect(s.w.feature(F)?.lifecycle).toBe('active');
    expect(code(s.go('archive'))).toBe('ok');
    expect(code(s.go('note', admin, { note: 'late' }))).toBe('case_closed');
    expect(code(s.go('reopen'))).toBe('case_closed');
  });
  it('a deleted feature accepts no run', () => {
    const s = setup();
    expect(code(s.go('remove'))).toBe('ok');
    expect(code(s.go('note', admin, { note: 'late' }))).toBe('case_closed');
  });
  it('deleting needs permissions.delete for a bound actor', () => {
    const s = setup();
    const denied = s.go('remove', worker);
    expect(code(denied)).toBe('not_permitted');
    expect(s.w.feature(F)?.lifecycle).toBe('active');
    expect(code(s.go('remove', boss))).toBe('ok');
    expect(s.w.feature(F)?.lifecycle).toBe('deleted');
  });
  it('other states need no delete permission', () => {
    const s = setup();
    expect(code(s.go('archive', worker))).toBe('ok');
  });
});
